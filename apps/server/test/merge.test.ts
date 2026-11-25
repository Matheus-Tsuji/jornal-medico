// Fusão da vitrine (Git) no banco de produção: só acrescenta conteúdo e nunca toca em usuários nem em publicadas.
import { describe, expect, it } from 'vitest';
import { analyzeArticle } from '../src/ai/analysis.ts';
import { openDb, type Db } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { mergeContent } from '../src/db/merge.ts';
import { decide } from '../src/modules/editorial.ts';
import { importOfficialBatch, listMonitor } from '../src/modules/monitor.ts';
import { discover } from '../src/worker/ingestion.ts';
import { fakeAdapter, fakeProvider, testConfig, validEditorial, validExtraction } from './helpers.ts';

const AI = { OPENAI_API_KEY: 'test-key-not-real', OPENAI_ANALYSIS_MODEL: 'gpt-6.1-terra', OPENAI_EDITORIAL_MODEL: 'gpt-6-luna' };
const cfg = testConfig(AI);

/** Banco "de verdade": esquema, semente (ids novos em cada um) e, se pedido, a coleta fictícia. */
async function db(withArticles: boolean): Promise<Db> {
  const d = openDb(':memory:');
  seed(d, cfg);
  if (withArticles) await discover(d, cfg, fakeAdapter(), 'hipertensao-arterial');
  return d;
}
const article = (d: Db) => d.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
const analyze = (d: Db, extra: Partial<ReturnType<typeof validExtraction>> = {}) =>
  analyzeArticle(d, cfg, fakeProvider([validExtraction(extra), validEditorial]), article(d));
const count = (d: Db, sql: string) => d.get<{ n: number }>(sql)!.n;
const admin = (d: Db) => {
  d.run("INSERT INTO users (id, email, role, verified_at, created_at) VALUES ('u-admin','a@example.com','admin','2026-11-20','2026-11-20')");
  return { id: 'u-admin', role: 'admin' };
};

describe('mergeContent', () => {
  it('traz artigos e análise novos, com temas e fontes mapeados pela chave natural, e é idempotente', async () => {
    const src = await db(true);
    await analyze(src);
    const dst = await db(false); // mesmos slugs, ids diferentes
    const first = mergeContent(src, dst);
    expect(first.articles).toBeGreaterThan(0);
    expect(first.analyses).toBe(1);
    expect(count(dst, "SELECT COUNT(*) AS n FROM analyses WHERE status = 'in_review' AND is_demo = 0")).toBe(1);
    expect(count(dst, 'SELECT COUNT(*) AS n FROM evidence_results')).toBeGreaterThan(0);
    // todo tema do artigo aponta para um tema que existe no destino
    expect(count(dst, 'SELECT COUNT(*) AS n FROM article_topics at LEFT JOIN topics t ON t.id = at.topic_id WHERE t.id IS NULL')).toBe(0);
    expect(count(dst, 'SELECT COUNT(*) AS n FROM articles a LEFT JOIN sources s ON s.id = a.source_id WHERE s.id IS NULL')).toBe(0);

    const again = mergeContent(src, dst);
    expect(again).toMatchObject({ articles: 0, articleSources: 0, analyses: 0, superseded: 0, documents: 0 });
  });

  it('casa o mesmo artigo por PMID/DOI mesmo com ids diferentes e anexa a análise ao artigo do destino', async () => {
    const src = await db(true);
    await analyze(src);
    const dst = await db(true); // já coletou o mesmo artigo, com outro id
    expect(article(src)).not.toBe(article(dst));
    const total = count(dst, 'SELECT COUNT(*) AS n FROM articles');
    const r = mergeContent(src, dst);
    expect(r.articles).toBe(0);
    expect(count(dst, 'SELECT COUNT(*) AS n FROM articles')).toBe(total);
    expect(dst.get<{ article_id: string }>("SELECT article_id FROM analyses WHERE status = 'in_review' AND is_demo = 0")!.article_id).toBe(article(dst));
  });

  it('nunca toca em usuários nem em análise publicada; rascunho novo convive e ganha a próxima versão', async () => {
    const dst = await db(true);
    const reviewer = admin(dst);
    const published = await analyze(dst);
    decide(dst, reviewer, published.analysisId!, { decision: 'approve', justification: 'conferido' });
    const before = dst.get<{ payload: string; status: string }>('SELECT payload, status FROM analyses WHERE id = ?', published.analysisId!)!;
    expect(before.status).toBe('published');

    const src = await db(true);
    // insumo diferente (abstract mudou na vitrine): análise nova, não duplicada
    src.run("UPDATE article_sources SET abstract_text = abstract_text || ' Errata.' WHERE article_id = ?", article(src));
    await analyze(src);
    // e uma "publicada" forjada na vitrine jamais entra
    src.run(
      `INSERT INTO analyses (id, article_id, version, model, prompt_version, language, input_scope, input_hash, status, payload, created_at, published_at)
       VALUES ('forjada', ?, 99, 'x', 'x', 'pt-BR', 'abstract_only', 'h-forjado', 'published', '{}', '2026-11-25', '2026-11-25')`, article(src),
    );
    const usersBefore = count(dst, 'SELECT COUNT(*) AS n FROM users');

    const r = mergeContent(src, dst);
    expect(r.analyses).toBe(1);
    expect(dst.get('SELECT 1 FROM analyses WHERE id = ?', 'forjada')).toBeUndefined();
    const after = dst.get<{ payload: string; status: string }>('SELECT payload, status FROM analyses WHERE id = ?', published.analysisId!)!;
    expect(after).toEqual(before); // publicada intacta
    expect(count(dst, 'SELECT COUNT(*) AS n FROM users')).toBe(usersBefore);
    expect(count(dst, 'SELECT COUNT(*) AS n FROM editorial_reviews')).toBe(1);
    const versions = dst.all<{ version: number }>('SELECT version FROM analyses WHERE article_id = ? ORDER BY version', article(dst)).map((v) => v.version);
    expect(new Set(versions).size).toBe(versions.length); // sem colisão de versão
  });

  it('rascunho novo aposenta o rascunho anterior do destino; mesma análise não é duplicada', async () => {
    const dst = await db(true);
    const old = await analyze(dst);
    const src = await db(true);
    src.run("UPDATE article_sources SET abstract_text = abstract_text || ' Errata.' WHERE article_id = ?", article(src));
    await analyze(src);
    const r = mergeContent(src, dst);
    expect(r.superseded).toBe(1);
    expect(dst.get<{ status: string }>('SELECT status FROM analyses WHERE id = ?', old.analysisId!)!.status).toBe('superseded');
    expect(count(dst, "SELECT COUNT(*) AS n FROM analyses WHERE status = 'in_review' AND is_demo = 0")).toBe(1);
  });

  it('retratação só avança; triagem por falta de abstract reabre', async () => {
    const src = await db(true);
    const dst = await db(true);
    src.run("UPDATE articles SET retraction_status = 'retracted' WHERE id = ?", article(src));
    mergeContent(src, dst);
    expect(dst.get<{ r: string }>('SELECT retraction_status AS r FROM articles WHERE id = ?', article(dst))!.r).toBe('retracted');
    src.run("UPDATE articles SET retraction_status = 'none' WHERE id = ?", article(src));
    mergeContent(src, dst);
    expect(dst.get<{ r: string }>('SELECT retraction_status AS r FROM articles WHERE id = ?', article(dst))!.r).toBe('retracted'); // nunca desfaz

    dst.run("UPDATE articles SET triage_status = 'excluded', triage_reason = 'Sem abstract: apenas metadados disponíveis' WHERE id = ?", article(dst));
    src.run("UPDATE articles SET triage_status = 'eligible' WHERE id = ?", article(src));
    mergeContent(src, dst);
    expect(dst.get<{ t: string }>('SELECT triage_status AS t FROM articles WHERE id = ?', article(dst))!.t).toBe('eligible');
  });

  it('documentos oficiais lidos de páginas: validados, importados e fundidos; item ruim não derruba o lote', async () => {
    const src = await db(false);
    const ok = { source: 'conitec', title: 'Recomendação Conitec de teste', identifier: 'Relatório 999', description: 'Ementa literal fictícia do documento.', date: '2026-11-20', url: 'https://www.gov.br/conitec/pt-br/exemplo', confirmedVerbatim: true };
    const r = importOfficialBatch(src, [ok, { ...ok, url: 'https://exemplo.com/x' }, { lixo: true }]);
    expect(r.map((x) => x.status)).toEqual(['imported', 'rejected', 'rejected']);
    const dst = await db(false);
    expect(mergeContent(src, dst).documents).toBe(1);
    expect(listMonitor(dst, 'regulation').items.some((d) => d.identifier === 'Relatório 999')).toBe(true);
  });
});
