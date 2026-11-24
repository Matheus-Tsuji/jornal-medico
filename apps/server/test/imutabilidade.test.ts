// Invariantes da migração 014: análise aprovada (e suas filhas) não muda; correção só por nova versão.
import { describe, expect, it } from 'vitest';
import { analyzeArticle } from '../src/ai/analysis.ts';
import { copyDb } from '../src/db/copy.ts';
import { openDb } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decide } from '../src/modules/editorial.ts';
import { discover } from '../src/worker/ingestion.ts';
import { fakeAdapter, fakeProvider, login, setup, testConfig, validEditorial, validExtraction } from './helpers.ts';

const AI = { OPENAI_API_KEY: 'test-key-not-real', OPENAI_ANALYSIS_MODEL: 'gpt-6.1-terra', OPENAI_EDITORIAL_MODEL: 'gpt-6-luna' };
const IMUTAVEL = /imutável/;

async function published() {
  const c = await setup(AI);
  await discover(c.db, c.cfg, fakeAdapter(), 'hipertensao-arterial');
  const articleId = c.db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
  const { analysisId } = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), articleId);
  await login(c.app, c.db, 'admin@example.com');
  const reviewer = { id: c.db.get<{ id: string }>("SELECT id FROM users WHERE email = 'admin@example.com'")!.id, role: 'admin' };
  decide(c.db, reviewer, analysisId!, { decision: 'approve', justification: 'Conferido com a fonte.' });
  return { ...c, articleId, analysisId, reviewer };
}

describe('014: selo de publicação', () => {
  it('aprovar sela; análise e filhas recusam INSERT/UPDATE/DELETE', async () => {
    const { db, analysisId } = await published();
    expect(db.get('SELECT 1 AS ok FROM analysis_seals WHERE analysis_id = ?', analysisId)).toEqual({ ok: 1 });
    const res = db.get<{ id: string }>('SELECT id FROM evidence_results WHERE analysis_id = ? LIMIT 1', analysisId)!;
    expect(() => db.run('DELETE FROM analyses WHERE id = ?', analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run("UPDATE analyses SET editorial_priority = 99 WHERE id = ?", analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run('UPDATE evidence_results SET outcome = ? WHERE id = ?', 'outro', res.id)).toThrow(IMUTAVEL);
    expect(() => db.run('DELETE FROM evidence_results WHERE analysis_id = ?', analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run("INSERT INTO evidence_results (id, analysis_id, ord, outcome) SELECT 'x', analysis_id, 99, outcome FROM evidence_results WHERE id = ?", res.id)).toThrow(IMUTAVEL);
    expect(() => db.run('DELETE FROM claims WHERE analysis_id = ?', analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run("INSERT INTO claims (id, analysis_id, ord, text, locator, quote, support, origin, verified) VALUES ('c', ?, 99, 't', 'abstract', null, 'direct', 'authors', 0)", analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run("UPDATE analysis_seals SET sealed_at = 'x'")).toThrow(/permanente/);
  });

  it('correção continua possível: published → superseded passa; superseded não muda nem volta', async () => {
    const { db, analysisId } = await published();
    db.run("UPDATE analyses SET status = 'superseded' WHERE id = ?", analysisId);
    expect(() => db.run("UPDATE analyses SET status = 'published' WHERE id = ?", analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run("UPDATE analyses SET payload = '{}' WHERE id = ?", analysisId)).toThrow(IMUTAVEL);
    expect(() => db.run('DELETE FROM analyses WHERE id = ?', analysisId)).toThrow(IMUTAVEL);
  });

  it('nova versão aprovada pelo fluxo editorial substitui a anterior (mecanismo de correção)', async () => {
    const { db, analysisId, reviewer } = await published();
    db.run(`INSERT INTO analyses (id, article_id, version, model, prompt_version, language, input_scope, input_hash, status, payload, validation, editorial_priority, is_demo, created_at, validator_version)
            SELECT 'v2', article_id, version + 1, model, prompt_version, language, input_scope, input_hash || '-v2', 'in_review', payload, validation, editorial_priority, 0, created_at, validator_version FROM analyses WHERE id = ?`, analysisId);
    decide(db, reviewer, 'v2', { decision: 'approve', justification: 'Correção conferida com a fonte.' });
    expect(db.get<{ status: string }>('SELECT status FROM analyses WHERE id = ?', analysisId)!.status).toBe('superseded');
    expect(db.get<{ status: string }>("SELECT status FROM analyses WHERE id = 'v2'")!.status).toBe('published');
    expect(db.get('SELECT 1 AS ok FROM analysis_seals WHERE analysis_id = ?', 'v2')).toEqual({ ok: 1 });
  });

  it('rascunho e demo seguem editáveis (reprocessamento, revalidate, seed)', async () => {
    const c = await setup(AI);
    await discover(c.db, c.cfg, fakeAdapter(), 'hipertensao-arterial');
    const articleId = c.db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
    const { analysisId } = await analyzeArticle(c.db, c.cfg, fakeProvider([validExtraction(), validEditorial]), articleId);
    c.db.run("UPDATE analyses SET validation = '[]' WHERE id = ?", analysisId);
    c.db.run('DELETE FROM claims WHERE analysis_id = ?', analysisId);
    const demo = c.db.get<{ id: string }>("SELECT id FROM analyses WHERE status = 'demo' LIMIT 1");
    if (demo) c.db.run("UPDATE analyses SET published_at = published_at WHERE id = ?", demo.id);
  });

  it('copyDb leva análises publicadas para destino com dados publicados antigos', async () => {
    const { db } = await published();
    const dst = openDb(':memory:');
    seed(dst, testConfig());
    copyDb(db, dst);
    copyDb(db, dst); // segunda cópia: destino já tem selos e filhas
    for (const t of ['analyses', 'evidence_results', 'claims', 'analysis_seals']) {
      expect(dst.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n).toBe(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n);
    }
    expect(dst.get<{ n: number }>('SELECT COUNT(*) AS n FROM analysis_seals')!.n).toBeGreaterThan(0);
  });
  it('backfill: sela published e superseded publicada; superseded que nunca foi publicada fica sem selo', async () => {
    const { db, analysisId } = await published();
    // Volta ao estado anterior à 014 e cria o legado: rascunho substituído por reprocessamento (published_at nulo).
    const sql = readFileSync(join(import.meta.dirname, '../src/db/migrations/014_selo_publicacao.sql'), 'utf8');
    for (const t of sql.matchAll(/CREATE TRIGGER (\w+)/g)) db.raw.exec(`DROP TRIGGER ${t[1]}`);
    db.raw.exec('DROP TABLE analysis_seals');
    const clone = (newId: string, status: string, publishedAt: string | null, v: number) => db.run(
      `INSERT INTO analyses (id, article_id, version, model, prompt_version, language, input_scope, input_hash, status, payload, validation, editorial_priority, is_demo, created_at, published_at, validator_version)
       SELECT ?, article_id, ?, model, prompt_version, language, input_scope, input_hash || ?, ?, payload, validation, editorial_priority, 0, created_at, ?, validator_version FROM analyses WHERE id = ?`,
      newId, v, newId, status, publishedAt, analysisId);
    clone('legado-rascunho', 'superseded', null, 10);
    clone('legado-publicada', 'superseded', '2026-01-01T00:00:00.000Z', 11);
    db.raw.exec(sql);
    const sealed = db.all<{ analysis_id: string }>('SELECT analysis_id FROM analysis_seals ORDER BY analysis_id').map((r) => r.analysis_id);
    expect(sealed).toEqual([analysisId, 'legado-publicada'].sort());
    db.run("UPDATE analyses SET validation = '[]' WHERE id = 'legado-rascunho'"); // sem selo: não bloqueado
    expect(() => db.run("UPDATE analyses SET validation = '[]' WHERE id = 'legado-publicada'")).toThrow(IMUTAVEL);
  });
});
