import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { discover } from '../src/worker/ingestion.ts';
import { exportPending, importAnalyses } from '../src/ai/handoff.ts';
import { fakeAdapter, testConfig, validEditorial, validExtraction } from './helpers.ts';

async function setupDb() {
  const cfg = testConfig();
  const db = openDb(':memory:');
  seed(db, cfg);
  await discover(db, cfg, fakeAdapter(), 'hipertensao-arterial');
  return db;
}

describe('análise por entrega de arquivo (sem chave de API)', () => {
  it('exporta documentos pendentes com os prompts e importa como rascunho, nunca publicado', async () => {
    const db = await setupDb();
    const ex = exportPending(db, 50);
    expect(ex.items.length).toBeGreaterThan(0);
    expect(ex.instructions.extraction).toContain('EXTRAIR');
    const item = ex.items.find((i) => i.document.includes('hazard ratio, 0.80'))!;
    expect(item).toBeTruthy();

    const res = importAnalyses(db, [{ articleId: item.articleId, inputHash: item.inputHash, promptVersion: item.promptVersion, extraction: validExtraction(), editorial: validEditorial }]);
    expect(res[0]!.status).toBe('in_review');
    const row = db.get<{ status: string; model: string }>('SELECT status, model FROM analyses WHERE article_id = ? AND is_demo = 0', item.articleId)!;
    expect(row.status).toBe('in_review');
    expect(row.model).toBe('claude-rotina-diaria');
    expect(db.get('SELECT 1 FROM editorial_reviews')).toBeUndefined();

    // já analisado: sai da fila e reimportar é ignorado
    expect(exportPending(db, 50).items.find((i) => i.articleId === item.articleId)).toBeUndefined();
    expect(importAnalyses(db, [{ articleId: item.articleId, inputHash: item.inputHash, promptVersion: item.promptVersion, extraction: validExtraction(), editorial: validEditorial }])[0]!.status).toBe('skipped_existing');
  });

  it('bloqueia extração incoerente e redação com número inventado; rejeita schema inválido', async () => {
    const db = await setupDb();
    const item = exportPending(db, 50).items.find((i) => i.document.includes('hazard ratio, 0.80'))!;
    const bad = validExtraction();
    bad.results[0]!.confidenceInterval = { level: 95, lower: 0.97, upper: 0.66, raw: '0.97 to 0.66' };
    expect(importAnalyses(db, [{ articleId: item.articleId, inputHash: item.inputHash, promptVersion: item.promptVersion, extraction: bad, editorial: validEditorial }])[0]!.status).toBe('blocked');

    const db2 = await setupDb();
    const it2 = exportPending(db2, 50).items.find((i) => i.document.includes('hazard ratio, 0.80'))!;
    const r = importAnalyses(db2, [{ articleId: it2.articleId, inputHash: it2.inputHash, promptVersion: it2.promptVersion, extraction: validExtraction(), editorial: { ...validEditorial, summary: 'Reduziu 42% o risco.' } }]);
    expect(r[0]!.status).toBe('blocked');
    expect(importAnalyses(db2, [{ articleId: 'x', extraction: { foo: 1 }, editorial: {} }])[0]!.status).toBe('rejected');
  });
});
