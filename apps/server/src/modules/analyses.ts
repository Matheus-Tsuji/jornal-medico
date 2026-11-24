// Persistência de análises versionadas. Uma análise publicada é imutável:
// correções criam nova versão e a anterior vira 'superseded'.
import type { AiAnalysis } from '@jm/contracts';
import type { Db } from '../db/index.ts';
import { id, nowIso } from '../lib/util.ts';
import { VALIDATOR_VERSION, validateAnalysis, validateEditorial } from '../ai/validator.ts';

export function claimsOf(db: Db, analysisId: string): AiAnalysis['claims'] {
  return db.all<AiAnalysis['claims'][number]>('SELECT text, locator, quote, support, origin FROM claims WHERE analysis_id = ? ORDER BY ord', analysisId);
}

export interface AnalysisMeta {
  model: string;
  promptVersion: string;
  inputHash: string;
  status: 'in_review' | 'blocked' | 'demo';
  validation: string[];
  isDemo: boolean;
}

export function insertAnalysis(db: Db, articleId: string, a: AiAnalysis, meta: AnalysisMeta): string {
  const analysisId = id();
  db.tx(() => {
    // Um rascunho novo (reprocessamento) aposenta os rascunhos anteriores; versões publicadas não mudam.
    if (!meta.isDemo && (meta.status === 'in_review' || meta.status === 'blocked')) {
      db.run("UPDATE analyses SET status = 'superseded' WHERE article_id = ? AND status IN ('in_review','blocked')", articleId);
    }
    const v = db.get<{ v: number }>('SELECT COALESCE(MAX(version),0)+1 AS v FROM analyses WHERE article_id = ?', articleId)!.v;
    db.run(
      `INSERT INTO analyses (id, article_id, version, model, prompt_version, language, input_scope, input_hash, status, payload, validation, editorial_priority, is_demo, created_at, validator_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      analysisId, articleId, v, meta.model, meta.promptVersion, a.language, a.inputScope, meta.inputHash, meta.status,
      JSON.stringify({ ...a, results: undefined, claims: undefined }), JSON.stringify(meta.validation),
      Math.max(0, Math.min(1, a.editorialPriority.score)), meta.isDemo ? 1 : 0, nowIso(), VALIDATOR_VERSION,
    );
    a.results.forEach((r, i) => {
      db.run(
        `INSERT INTO evidence_results (id, analysis_id, ord, outcome, outcome_type, measure, measure_kind, estimate, estimate_raw, unit, comparator, population, timepoint,
          ci_level, ci_lower, ci_upper, ci_raw, p_raw, p_operator, p_value, sample_size, adjusted, evidence_locator, evidence_quote, missing_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id(), analysisId, i, r.outcome, r.outcomeType, r.measure, r.measureKind, r.estimate, r.estimateRaw, r.unit, r.comparator, r.population, r.timepoint,
        r.confidenceInterval?.level ?? null, r.confidenceInterval?.lower ?? null, r.confidenceInterval?.upper ?? null, r.confidenceInterval?.raw ?? null,
        r.pValue?.raw ?? null, r.pValue?.operator ?? null, r.pValue?.value ?? null, r.sampleSize, r.adjusted === null ? null : r.adjusted ? 1 : 0,
        r.evidenceRef.locator, r.evidenceRef.quote, r.missingReason,
      );
    });
    a.claims.forEach((c, i) => {
      db.run(
        'INSERT INTO claims (id, analysis_id, ord, text, locator, quote, support, origin, verified) VALUES (?,?,?,?,?,?,?,?,?)',
        id(), analysisId, i, c.text, c.locator, c.quote, c.support, c.origin, 0,
      );
    });
  });
  return analysisId;
}

/**
 * Já existe análise para este insumo? Rascunhos bloqueados/rejeitados feitos com um validador mais antigo não contam
 * (o validador mudou: vale tentar de novo). `retry` ignora bloqueados/rejeitados de qualquer versão (nova tentativa
 * explícita; cria nova versão, o histórico fica).
 */
export function alreadyAnalyzed(db: Db, articleId: string, inputHash: string, retry = false): string | null {
  return db.get<{ id: string }>(
    `SELECT id FROM analyses WHERE article_id = ? AND input_hash = ?
       AND (status NOT IN ('blocked','rejected') OR (? = 0 AND validator_version = ?)) LIMIT 1`,
    articleId, inputHash, retry ? 1 : 0, VALIDATOR_VERSION,
  )?.id ?? null;
}

export interface EditorialText { editorialHeadline: string | null; summary: string | null; inShort: string | null; plainResult: string | null }

/**
 * Validação final e gravação, comum ao pipeline da API e ao claude-import: mesmos validadores, mesmas regras de
 * bloqueio. Grava sempre como rascunho ('in_review' ou 'blocked'); publicar exige decisão editorial humana.
 */
export function finalizeAnalysis(
  db: Db, articleId: string, extraction: AiAnalysis, editorial: EditorialText | { error: string }, doc: string,
  meta: { model: string; promptVersion: string; inputHash: string },
): { analysisId: string; status: 'in_review' | 'blocked'; detail: string[] } {
  const m = { ...meta, isDemo: false };
  const base: AiAnalysis = { ...extraction, editorialHeadline: null, summary: null, inShort: null, plainResult: null };
  const report = validateAnalysis(base, doc, 'abstract_only');
  if (report.errors.length) {
    const analysisId = insertAnalysis(db, articleId, { ...base, reviewFlags: [...new Set([...report.flags, 'validation_failed' as const])] }, { ...m, status: 'blocked', validation: [...report.errors, ...report.warnings] });
    return { analysisId, status: 'blocked', detail: report.errors };
  }
  const extractionJson = JSON.stringify(base);
  const edErrors = 'error' in editorial ? [`Redação inválida: ${editorial.error}`] : validateEditorial(editorial, extractionJson, doc).errors;
  const final: AiAnalysis = { ...base, ...(edErrors.length || 'error' in editorial ? {} : editorial), reviewFlags: report.flags };
  if (edErrors.length) final.reviewFlags = [...new Set([...final.reviewFlags, 'validation_failed' as const])];
  const problems = [...report.warnings, ...edErrors.map((e) => `Redação: ${e}`)];
  const status = edErrors.length ? 'blocked' : 'in_review';
  return { analysisId: insertAnalysis(db, articleId, final, { ...m, status, validation: problems }), status, detail: problems };
}
