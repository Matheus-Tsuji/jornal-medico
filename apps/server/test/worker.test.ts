// Fase 3 da auditoria de backend: worker, ingestão, fila e recomendador.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { analyzeArticle, checkBudget, releaseBudget } from '../src/ai/analysis.ts';
import { AI_CALL_TIMEOUT_MS } from '../src/ai/provider.ts';
import { openDb, type Db } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { TransientError } from '../src/lib/net.ts';
import { claim, complete, enqueue, heartbeat } from '../src/modules/jobs.ts';
import { rankCandidates, recommend, type Candidate, type Profile } from '../src/modules/ranking.ts';
import { europePmcAdapter } from '../src/sources/europepmc.ts';
import { parsePubmedXml, type NormalizedRecord, type ScientificSourceAdapter } from '../src/sources/pubmed.ts';
import { discover, upsertRecord } from '../src/worker/ingestion.ts';
import { runCycle, runJob, workOnce } from '../src/worker/runner.ts';
import { H, fakeAdapter, fakeProvider, fixtureXml, login, setup, testConfig, validEditorial, validExtraction } from './helpers.ts';

const AI = { OPENAI_API_KEY: 'test-key-not-real', OPENAI_ANALYSIS_MODEL: 'gpt-6.1-terra', OPENAI_EDITORIAL_MODEL: 'gpt-6-luna' };
const fresh = (over: Record<string, string> = {}) => {
  const cfg = testConfig(over);
  const db = openDb(':memory:');
  seed(db, cfg);
  return { db, cfg };
};
const base = parsePubmedXml(fixtureXml)[0]!;
/** Registros fictícios (PMIDs 9999910x, DOIs 10.99999/*) com datas de indexação distintas. */
const fake = (n: number, date: string): NormalizedRecord => ({
  ...base, externalId: `9999910${n}`, pmid: `9999910${n}`, doi: `10.99999/fase3.${n}`, title: `Synthetic trial ${n} of drug Z`, indexedAt: date,
});
const srcId = (db: Db, slug: string) => db.get<{ id: string }>('SELECT id FROM sources WHERE slug = ?', slug)!.id;
const topicId = (db: Db) => db.get<{ id: string }>("SELECT id FROM topics WHERE slug = 'hipertensao-arterial'")!.id;

describe('FUN-02: artigo gravado sempre ganha job de análise', () => {
  it('falha no meio do lote e reexecução: 100% dos elegíveis com job', async () => {
    const { db, cfg } = fresh();
    const recs = parsePubmedXml(fixtureXml);
    // "Queda" depois de gravar o primeiro artigo, antes do fim da descoberta:
    upsertRecord(db, srcId(db, 'pubmed'), topicId(db), recs[0]!);
    await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    const semJob = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM articles ar WHERE ar.triage_status = 'eligible' AND ar.is_demo = 0
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type = 'analyze' AND json_extract(j.payload, '$.articleId') = ar.id)`,
    )!.n;
    expect(semJob).toBe(0);
  });
});

describe('FUN-03: abstract que chega por outra fonte', () => {
  it('Europe PMC propaga 429 ao buscar o abstract', async () => {
    const hit = { id: 'PMC1', source: 'PMC', pmcid: 'PMC1', title: 'Drug A for hypertension: a meta-analysis.', language: 'eng' };
    const f = (async (u: URL) => {
      if (String(u).includes('/search?')) return new Response(JSON.stringify({ hitCount: 1, resultList: { result: [hit] } }));
      return new Response('limite', { status: 429 });
    }) as unknown as typeof fetch;
    const a = europePmcAdapter(f);
    const { ids } = await a.search('hypertension[tiab]', '2026-11-09', '2026-11-16', 5);
    await expect(a.fetchDetails(ids)).rejects.toBeInstanceOf(TransientError);
  });

  it('mesmo DOI sem abstract (fonte A) e depois com abstract (fonte B): duas fontes, elegível e enfileirado', () => {
    const { db } = fresh();
    const r = fake(1, '2026-11-10');
    const a = upsertRecord(db, srcId(db, 'pubmed'), topicId(db), { ...r, abstract: null });
    expect(db.get<{ triage_status: string }>('SELECT triage_status FROM articles WHERE id = ?', a.articleId)!.triage_status).toBe('excluded');
    expect(a.queued).toBe(false);
    const b = upsertRecord(db, srcId(db, 'europepmc'), topicId(db), { ...r, externalId: 'PMC:9', abstract: base.abstract });
    expect(b.articleId).toBe(a.articleId);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ?', a.articleId)!.n).toBe(2);
    expect(db.get<{ triage_status: string }>('SELECT triage_status FROM articles WHERE id = ?', a.articleId)!.triage_status).toBe('eligible');
    expect(b.queued).toBe(true);
  });
});

describe('FUN-04: janela maior que o limite', () => {
  const adapterFor = (recs: NormalizedRecord[]): ScientificSourceAdapter => ({
    slug: 'pubmed',
    async search(_q, from, to, max) {
      const hits = recs.filter((r) => r.indexedAt! >= from && r.indexedAt! <= to);
      return { ids: hits.slice(0, max).map((r) => r.pmid!), total: hits.length };
    },
    async fetchDetails(ids) {
      return recs.filter((r) => ids.includes(r.pmid!));
    },
  });
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  it('divide por datas e coleta tudo antes de avançar o cursor', async () => {
    const { db, cfg } = fresh({ INGEST_MAX_PER_TOPIC: '2' });
    const recs = [1, 2, 3, 4, 5, 6].map((n) => fake(n, day(n)));
    const r = await discover(db, cfg, adapterFor(recs), 'hipertensao-arterial');
    expect(r.fetched).toBe(6);
    expect(r.incomplete).toBeNull();
    expect(db.get('SELECT 1 FROM source_cursors')).toBeTruthy();
  });

  it('um dia que não cabe deixa a janela incompleta e o cursor parado', async () => {
    const { db, cfg } = fresh({ INGEST_MAX_PER_TOPIC: '2' });
    const recs = [1, 2, 3].map((n) => fake(n, day(2)));
    const r = await discover(db, cfg, adapterFor(recs), 'hipertensao-arterial');
    expect(r.incomplete).toMatch(/aumente INGEST_MAX_PER_TOPIC/);
    expect(db.get('SELECT 1 FROM source_cursors')).toBeUndefined();
  });
});

describe('ESC-02/COD-02/COD-03: fila', () => {
  it('worker com lease vencido não finaliza job retomado por outro; heartbeat estende o lease', () => {
    const { db } = fresh();
    const { id } = enqueue(db, 'compose', 'k1', { date: '2026-11-20' });
    const w1 = claim(db, 'w1')!;
    const before = db.get<{ lease_until: string }>('SELECT lease_until FROM jobs WHERE id = ?', id)!.lease_until;
    expect(heartbeat(db, w1, 10 * 60_000)).toBe(true);
    expect(db.get<{ lease_until: string }>('SELECT lease_until FROM jobs WHERE id = ?', id)!.lease_until > before).toBe(true);
    db.run("UPDATE jobs SET lease_until = '2000-01-01T00:00:00Z' WHERE id = ?", id);
    const w2 = claim(db, 'w2')!;
    expect(complete(db, w1, { de: 'w1' })).toBe(false);
    expect(complete(db, w2, { de: 'w2' })).toBe(true);
    expect(db.get<{ result: string }>('SELECT result FROM jobs WHERE id = ?', id)!.result).toContain('w2');
  });

  it('timeout de IA cabe no ciclo da Vercel', () => {
    expect(AI_CALL_TIMEOUT_MS * 4 + 115_000).toBeLessThanOrEqual(300_000);
  });

  it('payload corrompido vira failed e o ciclo segue', async () => {
    const { db, cfg } = fresh();
    db.run("INSERT INTO jobs (id, type, idempotency_key, payload, status, max_attempts, next_run_at, priority, created_at, updated_at) VALUES ('j1','analyze','k-bad','{lixo','queued',5,'2000-01-01',99,'2000-01-01','2000-01-01')");
    expect(await workOnce(db, cfg, { adapter: fakeAdapter(), provider: null }, 't')).toBe('analyze');
    expect(db.get<{ status: string }>("SELECT status FROM jobs WHERE id = 'j1'")!.status).toBe('failed');
  });

  it('job running com lease vencido e tentativas esgotadas vira failed, não volta', () => {
    const { db } = fresh();
    db.run("INSERT INTO jobs (id, type, idempotency_key, payload, status, attempts, max_attempts, next_run_at, lease_until, priority, created_at, updated_at) VALUES ('j2','compose','k2','{\"date\":\"2026-11-20\"}','running',5,5,'2000-01-01','2000-01-01',99,'2000-01-01','2000-01-01')");
    expect(claim(db, 'w')).toBeNull();
    expect(db.get<{ status: string }>("SELECT status FROM jobs WHERE id = 'j2'")!.status).toBe('failed');
  });

  it('handler que lança string não-Error falha o job com a mensagem', async () => {
    const { db, cfg } = fresh();
    enqueue(db, 'discover', 'd1', { topic: 'hipertensao-arterial' });
    const boom: ScientificSourceAdapter = { slug: 'pubmed', search: async () => { throw 'boom-string'; }, fetchDetails: async () => [] };
    await workOnce(db, cfg, { adapter: boom, provider: null }, 't');
    expect(db.get<{ status: string; last_error: string }>("SELECT status, last_error FROM jobs WHERE idempotency_key = 'd1'")).toMatchObject({ status: 'failed', last_error: 'boom-string' });
  });

  it('erro de banco no claim não rejeita o ciclo', async () => {
    const { db, cfg } = fresh();
    const flaky = new Proxy(db, {
      get(t, p, r) {
        if (p === 'get') return (sql: string, ...a: unknown[]) => { if (sql.includes('RETURNING')) throw new Error('database is locked'); return (t.get as (...x: unknown[]) => unknown).call(t, sql, ...a); };
        const v = Reflect.get(t, p, r);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    }) as Db;
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const r = await runCycle(flaky, cfg, { adapter: fakeAdapter(), provider: null }, { workerId: 't', budgetMs: 2_000, concurrency: 2 });
    log.mockRestore();
    expect(r.processed).toBe(0);
  });
});

describe('ESC-05: rechecagem de retratação em rodízio', () => {
  it('lotes sucessivos cobrem todos os artigos', async () => {
    const { db, cfg } = fresh();
    await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 0 AND pmid IS NOT NULL')!.n;
    expect(total).toBeGreaterThan(2);
    const deps = { adapter: fakeAdapter(), provider: null, recheckBatch: 2 };
    for (let i = 0; i < Math.ceil(total / 2); i++) await runJob(db, cfg, { id: 'x', type: 'recheck', payload: {}, attempts: 1, max_attempts: 5, idempotency_key: 'x', token: 'x' }, deps);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 0 AND pmid IS NOT NULL AND retraction_checked_at IS NULL')!.n).toBe(0);
  });
});

describe('ESC-12: teto de orçamento com chamadas em paralelo', () => {
  it('reservas nunca passam do teto e são liberadas', () => {
    const { db, cfg } = fresh({ ...AI, AI_DAILY_BUDGET_USD: '0.2' });
    const models = [cfg.OPENAI_ANALYSIS_MODEL!, cfg.OPENAI_EDITORIAL_MODEL!];
    const got: string[] = [];
    expect(() => { for (;;) got.push(checkBudget(db, cfg, models)!); }).toThrow(/Orçamento diário/);
    const reserved = db.get<{ s: number }>('SELECT SUM(amount_usd) AS s FROM ai_budget_reservations')!.s;
    expect(got.length).toBeGreaterThan(0);
    expect(reserved).toBeLessThanOrEqual(0.2);
    got.forEach((r) => releaseBudget(db, r));
    expect(db.get('SELECT 1 FROM ai_budget_reservations')).toBeUndefined();
    expect(checkBudget(db, cfg, models)).toBeTruthy();
  });

  it('análise concluída libera a reserva', async () => {
    const { db, cfg } = fresh({ ...AI, AI_DAILY_BUDGET_USD: '5' });
    await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    const art = db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
    await analyzeArticle(db, cfg, fakeProvider([validExtraction(), validEditorial]), art);
    expect(db.get('SELECT 1 FROM ai_budget_reservations')).toBeUndefined();
  });
});

describe('ESC-13: índice para duplicata por título', () => {
  it('consulta de duplicata usa o índice', () => {
    const { db } = fresh();
    const plan = db.all<{ detail: string }>("EXPLAIN QUERY PLAN SELECT id FROM articles WHERE lower(original_title) = lower(?) AND id <> ? LIMIT 1", 'x', 'y');
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/idx_articles_title_lower/);
  });
});

describe('recomendador', () => {
  const cands = JSON.parse(readFileSync(join(import.meta.dirname, '../../../services/recommender/tests/parity_case.json'), 'utf8')) as { candidates: Candidate[]; profile: Profile; expected: Record<string, { reasons: string[]; matchedTopics: string[] }> };

  it('paridade de motivos e matchedTopics com o Python (caso compartilhado)', () => {
    const out = rankCandidates(cands.candidates, cands.profile, cands.candidates.length);
    expect(Object.fromEntries(out.map((r) => [r.id, { reasons: r.reasons, matchedTopics: r.matchedTopics }]))).toEqual(cands.expected);
  });

  const withPython = async (respond: (cands: { id: string }[]) => Promise<Response> | Response) => {
    const c = await setup({ ...AI, RECOMMENDER_URL: 'http://127.0.0.1:8790' });
    await discover(c.db, c.cfg, fakeAdapter(), 'hipertensao-arterial');
    const art = c.db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
    await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), art);
    c.db.run("UPDATE feature_flags SET enabled = 1 WHERE key IN ('real_content','ai_preview')");
    const f = (async (_u: string, init: RequestInit) => respond(JSON.parse(String(init.body)).candidates)) as unknown as typeof fetch;
    return { ...c, f };
  };

  it('caminho de sucesso do Python', async () => {
    const { db, cfg, f } = await withPython((cs) => Response.json({ ranked: cs.map((x) => ({ id: x.id, score: 1, reasons: ['Seleção geral'], matchedTopics: [] })), model_version: 'v9' }));
    expect((await recommend(db, cfg, null, 5, f)).engine).toBe('python:v9');
  });

  it('resposta sem reasons, IDs repetidos ou timeout: baseline + log warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noReasons = await withPython((cs) => Response.json({ ranked: cs.map((x) => ({ id: x.id, score: 1, matchedTopics: [] })) }));
    expect((await recommend(noReasons.db, noReasons.cfg, null, 5, noReasons.f)).engine).toBe('baseline-ts-v1');
    const dup = await withPython((cs) => Response.json({ ranked: [cs[0], cs[0]].map((x) => ({ id: x!.id, score: 1, reasons: [], matchedTopics: [] })) }));
    expect((await recommend(dup.db, dup.cfg, null, 5, dup.f)).engine).toBe('baseline-ts-v1');
    const slow = await withPython(() => new Promise<Response>(() => {}));
    const slowF = (async (_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))))) as unknown as typeof fetch;
    void slow.f;
    const t0 = Date.now();
    expect((await recommend(slow.db, slow.cfg, null, 5, slowF)).engine).toBe('baseline-ts-v1');
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('recommender_fallback')).length).toBe(3);
    warn.mockRestore();
  });

  it('"Para você" filtra por tema seguido só com personalização ligada', async () => {
    const c = await setup(AI);
    await discover(c.db, c.cfg, fakeAdapter(), 'hipertensao-arterial');
    const art = c.db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
    await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), art);
    c.db.run("UPDATE feature_flags SET enabled = 1 WHERE key IN ('real_content','ai_preview')");
    const cookies = await login(c.app, c.db, 'leitor@example.com');
    const uid = c.db.get<{ id: string }>("SELECT id FROM users WHERE email = 'leitor@example.com'")!.id;
    const diabetes = c.db.get<{ id: string }>("SELECT id FROM topics WHERE slug = 'diabetes'")?.id ?? c.db.get<{ id: string }>("SELECT id FROM topics WHERE slug <> 'hipertensao-arterial' AND level = 'tema' LIMIT 1")!.id;
    c.db.run('INSERT INTO user_preferences (id, user_id, topic_id, follow, created_at, updated_at) VALUES (?,?,?,1,?,?)', 'pref-teste', uid, diabetes, '2026-11-24', '2026-11-24');
    const forYou = async () => (await c.app.inject({ url: '/api/v1/editions/latest', headers: H, cookies })).json().edition.forYou as unknown[];
    expect(await forYou()).toEqual([]); // segue outro tema: nada de hipertensão
    c.db.run('UPDATE users SET personalization_enabled = 0 WHERE id = ?', uid);
    expect((await forYou()).length).toBeGreaterThan(0); // personalização desligada: seleção geral
  });
});
