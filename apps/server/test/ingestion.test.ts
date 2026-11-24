import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { parsePubmedXml, pubmedAdapter } from '../src/sources/pubmed.ts';
import { discover, triage } from '../src/worker/ingestion.ts';
import { claim, complete, enqueue, retryLater } from '../src/modules/jobs.ts';
import { workOnce } from '../src/worker/runner.ts';
import { safeFetch, TransientError } from '../src/lib/net.ts';
import { fakeAdapter, fixtureXml, testConfig } from './helpers.ts';

const fresh = () => {
  const cfg = testConfig();
  const db = openDb(':memory:');
  seed(db, cfg);
  return { db, cfg };
};

describe('parser PubMed', () => {
  const recs = parsePubmedXml(fixtureXml);
  it('extrai identificadores, normaliza DOI e preserva desigualdades', () => {
    const a = recs[0]!;
    expect(a.pmid).toBe('99999901');
    expect(a.doi).toBe('10.99999/syn.0001');
    expect(a.title).toBe('Synthetic trial of drug Z versus placebo in hypertension');
    expect(a.abstract).toContain('p < 0.001');
    expect(a.abstract).toContain('1 200 adults aged ≥50 years'); // entidades numéricas decodificadas
    expect(a.abstract).toContain('RESULTS:');
    expect(a.pubDate).toBe('2026-11-10');
    expect(a.authors).toEqual(['Teste A', 'Synthetic Group']);
    expect(a.journal?.eissn).toBe('9999-0001');
  });
  it('lida com ausência de DOI, MedlineDate e retratação', () => {
    expect(recs[1]!.doi).toBeNull();
    expect(recs[1]!.pmcid).toBe('PMC9999902');
    expect(recs[1]!.pubDate).toBe('2026-01-01');
    expect(recs[2]!.retracted).toBe(true);
  });
  it('data da edição no futuro cai para a data de entrada no PubMed (ou nula)', () => {
    const future = fixtureXml.replace('<MedlineDate>2026 Oct-Nov</MedlineDate>', '<MedlineDate>2099 Jan</MedlineDate>');
    expect(parsePubmedXml(future)[1]!.pubDate).toBeNull();
    const withHistory = future.replace('<PubmedData><ArticleIdList><ArticleId IdType="pubmed">99999902', '<PubmedData><History><PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>11</Month><Day>8</Day></PubMedPubDate></History><ArticleIdList><ArticleId IdType="pubmed">99999902');
    expect(parsePubmedXml(withHistory)[1]!.pubDate).toBe('2026-11-08');
  });
  it('triagem: retratado e editorial excluídos; resultado não decide', () => {
    expect(triage(recs[0]!).status).toBe('eligible');
    expect(triage(recs[2]!).reason).toMatch(/retratada/);
    expect(triage(recs[3]!).status).toBe('excluded');
  });
});

describe('descoberta incremental', () => {
  it('insere, deduplica em nova execução e só avança cursor no sucesso', async () => {
    const { db, cfg } = fresh();
    const r1 = await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    expect(r1.inserted).toBe(4);
    expect(r1.queuedForAnalysis).toBe(2);
    const r2 = await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    expect(r2.inserted).toBe(0);
    expect(r2.duplicates).toBe(4);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM articles WHERE is_demo = 0")!.n).toBe(4);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE type = 'analyze'")!.n).toBe(2); // idempotente
    const cursor = db.get<{ cursor_date: string }>('SELECT cursor_date FROM source_cursors')!.cursor_date;

    db.run("UPDATE source_cursors SET cursor_date = '2026-01-01'");
    await expect(discover(db, cfg, fakeAdapter(fixtureXml, { failSearch: new TransientError('HTTP 429', 2000) }), 'hipertensao-arterial')).rejects.toThrow('429');
    expect(db.get<{ cursor_date: string }>('SELECT cursor_date FROM source_cursors')!.cursor_date).toBe('2026-01-01');
    expect(db.get<{ status: string }>('SELECT status FROM ingestion_runs ORDER BY started_at DESC LIMIT 1')!.status).toBe('failed');
    expect(cursor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('deduplica pelo DOI mesmo com PMID diferente', async () => {
    const { db, cfg } = fresh();
    await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    const twin = fixtureXml.replace('<PMID Version="1">99999901</PMID>', '<PMID Version="1">99999911</PMID>');
    const r = await discover(db, cfg, fakeAdapter(twin), 'diabetes');
    expect(r.inserted).toBe(0);
    // o artigo ganhou o segundo tema, sem duplicar
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM article_topics at JOIN articles a ON a.id = at.article_id WHERE a.doi = '10.99999/syn.0001'")!.n).toBe(2);
  });

  it('adapter real: respeita allowlist, trata 429 como transitório e timeout', async () => {
    const cfg = testConfig();
    const f429 = (async () => new Response('', { status: 429, headers: { 'retry-after': '3' } })) as typeof fetch;
    const e = await pubmedAdapter(cfg, f429).search('x', '2026-01-01', '2026-01-02', 5).catch((x) => x);
    expect(e).toBeInstanceOf(TransientError);
    expect((e as TransientError).retryAfterMs).toBe(3000);
    const fTimeout = (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as typeof fetch;
    expect(await pubmedAdapter(cfg, fTimeout).search('x', '2026-01-01', '2026-01-02', 5).catch((x) => x)).toBeInstanceOf(TransientError);
    let url = '';
    const fOk = (async (u: URL) => { url = String(u); return new Response(JSON.stringify({ esearchresult: { idlist: ['1'], count: '1' } })); }) as unknown as typeof fetch;
    expect((await pubmedAdapter(cfg, fOk).search('hypertension', '2026-01-01', '2026-01-02', 5)).ids).toEqual(['1']);
    expect(url).toContain('tool=jornal_medico');
    expect(url).toContain('datetype=edat');
  });

  it('safeFetch rejeita URL inválida, credenciais, porta não padrão e host fora da allowlist', async () => {
    let called = false;
    const f = (async () => { called = true; return new Response('ok'); }) as typeof fetch;
    for (const bad of [
      'nao-e-url',
      'http://api.crossref.org/works',
      'https://evil.example/works',
      'https://user:pass@api.crossref.org/works',
      'https://api.crossref.org:8443/works',
    ]) {
      await expect(safeFetch(bad, {}, f)).rejects.toMatchObject({ code: 'host_not_allowed' });
    }
    expect(called).toBe(false);
    const res = await safeFetch('https://api.crossref.org:443/works', {}, f);
    expect(res.ok).toBe(true);
    expect(called).toBe(true);
  });
});

describe('fila de jobs', () => {
  it('idempotência, lease expirado é retomado e backoff respeita Retry-After', () => {
    const { db } = fresh();
    const a = enqueue(db, 'compose', 'k1');
    expect(enqueue(db, 'compose', 'k1').created).toBe(false);
    const j = claim(db, 'w1')!;
    expect(j.id).toBe(a.id);
    expect(claim(db, 'w2')).toBeNull(); // lease válido: ninguém mais pega
    // simula worker morto: lease vencido
    db.run("UPDATE jobs SET lease_until = '2000-01-01T00:00:00Z' WHERE id = ?", a.id);
    const again = claim(db, 'w2')!;
    expect(again.id).toBe(a.id);
    expect(again.attempts).toBe(2);
    retryLater(db, again, 'HTTP 429', 120_000, () => 0);
    const row = db.get<{ status: string; next_run_at: string }>('SELECT status, next_run_at FROM jobs WHERE id = ?', a.id)!;
    expect(row.status).toBe('retry');
    expect(Date.parse(row.next_run_at) - Date.now()).toBeGreaterThan(110_000);
    expect(complete(db, again)).toBe(false); // depois de reagendado o job não é mais deste worker
  });

  it('job de análise sem chave OpenAI é adiado sem gastar tentativa (não falha em loop nem inventa)', async () => {
    const { db, cfg } = fresh();
    await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
    while (await workOnce(db, cfg, { adapter: fakeAdapter(), provider: null }, 't')) { /* drena: adiados não voltam na mesma rodada */ }
    const rows = db.all<{ status: string; last_error: string; attempts: number; next_run_at: string }>("SELECT status, last_error, attempts, next_run_at FROM jobs WHERE type = 'analyze'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.status).toBe('retry');
      expect(r.last_error).toMatch(/OPENAI_API_KEY/);
      expect(r.attempts).toBe(0);
      expect(Date.parse(r.next_run_at)).toBeGreaterThan(Date.now() + 5 * 3_600_000); // volta no próximo ciclo
    }
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM analyses WHERE is_demo = 0')!.n).toBe(0);
  });
});

describe('sanitização de erros', () => {
  it('remove segredos sem mutilar mensagens comuns', async () => {
    const { sanitize } = await import('../src/modules/jobs.ts');
    expect(sanitize('OPENAI_API_KEY e modelos não configurados')).toBe('OPENAI_API_KEY e modelos não configurados');
    expect(sanitize('api_key=abc123 falhou')).toBe('api_key=[redacted] falhou');
    expect(sanitize('Authorization: Bearer sk-abcdefghijk')).not.toContain('sk-abcdefghijk');
  });
});
