// Fase 2 da auditoria de backend: integridade científica e editorial.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeArticle, PROMPT_VERSION } from '../src/ai/analysis.ts';
import { exportPending, importAnalyses } from '../src/ai/handoff.ts';
import { VALIDATOR_VERSION, validateAnalysis } from '../src/ai/validator.ts';
import { openDb } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { decide, endOfEditionDay, publishEdition } from '../src/modules/editorial.ts';
import { recommend } from '../src/modules/ranking.ts';
import { discover } from '../src/worker/ingestion.ts';
import { H, fakeAdapter, fakeProvider, login, setup, testConfig, validEditorial, validExtraction } from './helpers.ts';

const AI = { OPENAI_API_KEY: 'test-key-not-real', OPENAI_ANALYSIS_MODEL: 'gpt-6.1-terra', OPENAI_EDITORIAL_MODEL: 'gpt-6-luna' };

async function ctx() {
  const c = await setup(AI);
  await discover(c.db, c.cfg, fakeAdapter(), 'hipertensao-arterial');
  const articleId = c.db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
  const doc = c.db.get<{ abstract_text: string }>('SELECT abstract_text FROM article_sources WHERE article_id = ?', articleId)!.abstract_text;
  return { ...c, articleId, doc };
}
const editor = { id: '', role: 'admin' };
async function adminId(c: Awaited<ReturnType<typeof ctx>>) {
  await login(c.app, c.db, 'admin@example.com');
  return { ...editor, id: c.db.get<{ id: string }>("SELECT id FROM users WHERE email = 'admin@example.com'")!.id };
}

describe('GER-02: validador bloqueia o que não está na fonte', () => {
  it('número fora da fonte, quote não literal, claim sem trecho e estimate ≠ estimateRaw viram erro', async () => {
    const { doc } = await ctx();
    const errs = (over: Parameters<typeof validExtraction>[0]) => validateAnalysis(validExtraction(over), doc, 'abstract_only').errors;
    expect(errs({})).toEqual([]);
    const r0 = validExtraction().results[0]!;
    expect(errs({ results: [{ ...r0, estimateRaw: '0.71', estimate: 0.71, confidenceInterval: { ...r0.confidenceInterval!, lower: 0.6 } }] }).length).toBeGreaterThan(0);
    expect(errs({ results: [{ ...r0, evidenceRef: { locator: 'abstract', quote: 'frase que não existe no abstract' } }] }).length).toBeGreaterThan(0);
    expect(errs({ claims: [{ text: 'X', locator: 'abstract', quote: null, support: 'direct', origin: 'authors' }] }).length).toBeGreaterThan(0);
    expect(errs({ results: [{ ...r0, estimateRaw: 'HR 0.80', estimate: 0.58, confidenceInterval: null }] }).join(' ')).toMatch(/estimateRaw/);
  });

  it('análise com número inventado fica blocked', async () => {
    const { db, cfg, articleId } = await ctx();
    const r0 = validExtraction().results[0]!;
    const bad = validExtraction({ results: [{ ...r0, estimateRaw: 'HR 0.80', estimate: 0.58, confidenceInterval: null }] });
    const r = await analyzeArticle(db, cfg, fakeProvider([bad, bad]), articleId);
    expect(r.status).toBe('blocked');
  });
});

describe('COD-04/COD-09: mesmo caminho de finalização', () => {
  it('API e claude-import bloqueiam a mesma falha científica', async () => {
    const a = await ctx();
    const bad = validExtraction({ claims: [{ text: 'X', locator: 'abstract', quote: 'inventado', support: 'direct', origin: 'authors' }] });
    expect((await analyzeArticle(a.db, a.cfg, fakeProvider([bad, bad]), a.articleId)).status).toBe('blocked');
    const b = await ctx();
    const item = exportPending(b.db, 50).items.find((i) => i.articleId === b.articleId)!;
    expect(importAnalyses(b.db, [{ articleId: item.articleId, inputHash: item.inputHash, promptVersion: item.promptVersion, extraction: bad, editorial: validEditorial }])[0]!.status).toBe('blocked');
  });

  it('tentativa 2 com schema inválido não esconde os erros da tentativa 1', async () => {
    const { db, cfg, articleId } = await ctx();
    const bad = validExtraction({ claims: [{ text: 'X', locator: 'abstract', quote: 'inventado', support: 'direct', origin: 'authors' }] });
    const r = await analyzeArticle(db, cfg, fakeProvider([bad, { lixo: true }]), articleId);
    expect(r.status).toBe('blocked');
    const v = JSON.parse(db.get<{ validation: string }>('SELECT validation FROM analyses WHERE id = ?', r.analysisId)!.validation) as string[];
    expect(v.join(' ')).toMatch(/claims\[0\]/);
    expect(v.join(' ')).not.toMatch(/Schema inválido/);
  });
});

describe('FUN-12: handoff recusa resposta obsoleta', () => {
  it('abstract alterado depois do export → rejected', async () => {
    const { db, articleId } = await ctx();
    const item = exportPending(db, 50).items.find((i) => i.articleId === articleId)!;
    db.run("UPDATE article_sources SET abstract_text = abstract_text || ' Errata.' WHERE article_id = ?", articleId);
    const r = importAnalyses(db, [{ articleId, inputHash: item.inputHash, promptVersion: item.promptVersion, extraction: validExtraction(), editorial: validEditorial }]);
    expect(r[0]!.status).toBe('rejected');
    expect(r[0]!.detail.join(' ')).toMatch(/obsoleta/);
    const r2 = importAnalyses(db, [{ articleId, inputHash: item.inputHash, promptVersion: 'outro', extraction: validExtraction(), editorial: validEditorial }]);
    expect(r2[0]!.status).toBe('rejected');
  });
});

describe('GER-08: decisão editorial', () => {
  it('payload corrompido → 409; edição com número inventado → recusa; blocked sem override → recusa', async () => {
    const c = await ctx();
    const ed = await adminId(c);
    const ok = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    expect(() => decide(c.db, ed, ok.analysisId!, { decision: 'approve', justification: 'conferido', edits: { summary: 'O risco caiu 73% com o fármaco Z em todos os pacientes.' } })).toThrow(/validador/);
    c.db.run("UPDATE analyses SET payload = '{quebrado' WHERE id = ?", ok.analysisId!);
    expect(() => decide(c.db, ed, ok.analysisId!, { decision: 'approve', justification: 'conferido' })).toThrow(/corrompido/);

    const c2 = await ctx();
    const ed2 = await adminId(c2);
    const bad = validExtraction({ claims: [{ text: 'X', locator: 'abstract', quote: 'inventado', support: 'direct', origin: 'authors' }] });
    const b = await analyzeArticle(c2.db, c2.cfg, fakeProvider([bad, bad]), c2.articleId);
    expect(b.status).toBe('blocked');
    expect(() => decide(c2.db, ed2, b.analysisId!, { decision: 'approve', justification: 'ok mesmo' })).toThrow(/overrideBlocked/);
  });
});

describe('GER-09: imutabilidade no banco', () => {
  it('UPDATE do payload de publicada falha; correção por nova versão continua funcionando', async () => {
    const c = await ctx();
    const ed = await adminId(c);
    const v1 = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    decide(c.db, ed, v1.analysisId!, { decision: 'approve', justification: 'conferido' });
    expect(() => c.db.run("UPDATE analyses SET payload = '{}' WHERE status = 'published'")).toThrow(/imutável/);
    const v2 = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId, null, { retry: true });
    // mesmo insumo: só refaz com retry quando bloqueada; aqui a v1 está publicada, então insere via novo prompt simulado
    expect(v2.status).toBe('skipped_existing');
    c.db.run("UPDATE article_sources SET abstract_text = abstract_text || ' ' WHERE article_id = ?", c.articleId);
    const v3 = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    decide(c.db, ed, v3.analysisId!, { decision: 'approve', justification: 'nova versão conferida' });
    expect(c.db.get<{ status: string }>('SELECT status FROM analyses WHERE id = ?', v1.analysisId!)!.status).toBe('superseded');
    expect(c.db.get('SELECT 1 FROM article_corrections WHERE article_id = ?', c.articleId)).toBeTruthy();
  });
});

describe('FUN-13/FUN-08: edições', () => {
  it('publicar recusa edição com artigo retratado depois da composição', async () => {
    const c = await ctx();
    const ed = await adminId(c);
    const r = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    decide(c.db, ed, r.analysisId!, { decision: 'approve', justification: 'conferido' });
    const today = new Date().toISOString().slice(0, 10);
    const admin = await login(c.app, c.db, 'admin@example.com');
    expect((await c.app.inject({ method: 'POST', url: `/api/v1/admin/editions/${today}/compose`, headers: H, cookies: admin })).json().items).toBe(1);
    c.db.run("UPDATE articles SET retraction_status = 'retracted' WHERE id = ?", c.articleId);
    expect(() => publishEdition(c.db, ed, today)).toThrow(/retratado/);
  });

  it('edição de data passada não inclui análise publicada depois', async () => {
    const c = await ctx();
    const ed = await adminId(c);
    const r = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    decide(c.db, ed, r.analysisId!, { decision: 'approve', justification: 'conferido' });
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(endOfEditionDay('2026-11-20')).toBe('2026-11-21T02:59:59.999Z');
    const admin = await login(c.app, c.db, 'admin@example.com');
    expect((await c.app.inject({ method: 'POST', url: `/api/v1/admin/editions/${yesterday}/compose`, headers: H, cookies: admin })).json().items).toBe(0);
  });
});

describe('FUN-06: uma análise por artigo, publicada vence rascunho', () => {
  it('v1 published + v2 in_review com ai_preview → só a v1 aparece', async () => {
    const c = await ctx();
    const ed = await adminId(c);
    const v1 = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    decide(c.db, ed, v1.analysisId!, { decision: 'approve', justification: 'conferido' });
    c.db.run("UPDATE article_sources SET abstract_text = abstract_text || ' ' WHERE article_id = ?", c.articleId);
    const v2 = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    expect(v2.status).toBe('in_review');
    c.db.run("UPDATE feature_flags SET enabled = 1 WHERE key IN ('real_content','ai_preview')");
    const items = (await c.app.inject({ url: '/api/v1/articles?limit=50' })).json().items as { slug: string; reviewStatus: string }[];
    const mine = items.filter((i) => i.slug.endsWith('pmid99999901'));
    expect(mine.map((i) => i.reviewStatus)).toEqual(['reviewed']); // um card só, e é o da versão publicada
    const rec = await recommend(c.db, c.cfg, null, 50);
    expect(rec.ranked.filter((x) => x.id === v1.analysisId || x.id === v2.analysisId).map((x) => x.id)).toEqual([v1.analysisId]);
  });
});

describe('FUN-15: versão do validador e nova tentativa', () => {
  it('bloqueada com validador antigo é refeita; retry cria nova versão sem apagar histórico', async () => {
    const c = await ctx();
    const bad = validExtraction({ claims: [{ text: 'X', locator: 'abstract', quote: 'inventado', support: 'direct', origin: 'authors' }] });
    const b = await analyzeArticle(c.db, c.cfg, fakeProvider([bad, bad]), c.articleId);
    expect((await analyzeArticle(c.db, c.cfg, fakeProvider([]), c.articleId)).status).toBe('skipped_existing');
    c.db.run('UPDATE analyses SET validator_version = ? WHERE id = ?', VALIDATOR_VERSION - 1, b.analysisId!);
    const again = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), c.articleId);
    expect(again.status).toBe('in_review');

    const retry = await ctx();
    const b2 = await analyzeArticle(retry.db, retry.cfg, fakeProvider([bad, bad]), retry.articleId);
    const r2 = await analyzeArticle(retry.db, retry.cfg, fakeProvider([validExtraction(), validEditorial]), retry.articleId, null, { retry: true });
    expect(r2.status).toBe('in_review');
    expect(retry.db.get<{ status: string }>('SELECT status FROM analyses WHERE id = ?', b2.analysisId!)!.status).toBe('superseded');
    expect(retry.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM analyses WHERE article_id = ?', retry.articleId)!.n).toBe(2);
  });
});

describe('GER-16: flags e versão de prompt', () => {
  it('seed não liga flag sem implementação', () => {
    process.env.FEATURE_AUDIO = 'true';
    try {
      const db = openDb(':memory:');
      seed(db, testConfig());
      expect(db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'audio'")!.enabled).toBe(0);
    } finally {
      delete process.env.FEATURE_AUDIO;
    }
  });

  it('PROMPT_VERSION aponta para arquivos existentes e prompt editado exige nova versão', () => {
    const dir = join(import.meta.dirname, '../src/ai/prompts');
    const files = PROMPT_VERSION.split('+').map((n) => `${n}.md`);
    for (const f of files) expect(readdirSync(dir)).toContain(f);
    // Se este teste falhar após editar um prompt: crie extraction.vN+1.md (etc.), atualize PROMPT_VERSION e o hash abaixo.
    const hashes = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)]));
    expect(hashes).toEqual(PROMPT_HASHES);
  });
});

const PROMPT_HASHES: Record<string, string> = {
  'triage.v1.md': 'e74ed5549bb3f5f4',
  'extraction.v2.md': 'b74d3e6d88680ecc',
  'editorial.v3.md': 'e85980d51bc0591b',
};
