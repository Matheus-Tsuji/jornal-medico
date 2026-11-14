// Pipeline de análise: extração estruturada → validação → redação editorial → validação → fila editorial.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { aiAnalysisSchema, type AiAnalysis } from '@jm/contracts';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { REPO_ROOT, json } from '../db/index.ts';
import { id, nowIso, sha256 } from '../lib/util.ts';
import { insertAnalysis } from '../modules/analyses.ts';
import type { AiProvider, Usage } from './provider.ts';
import { validateAnalysis, validateEditorial } from './validator.ts';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), 'prompts');
export const PROMPT_VERSION = 'triage.v1+extraction.v1+editorial.v2';
const TRIAGE = readFileSync(join(PROMPTS, 'triage.v1.md'), 'utf8');
const EXTRACTION = readFileSync(join(PROMPTS, 'extraction.v1.md'), 'utf8');
const EDITORIAL = readFileSync(join(PROMPTS, 'editorial.v2.md'), 'utf8');

export const editorialSchema = z.strictObject({ editorialHeadline: z.string().nullable(), summary: z.string().nullable(), inShort: z.string().nullable() });
export const triageSchema = z.strictObject({
  topicFit: z.enum(['central', 'secondary', 'tangential']),
  clinicalRelevance: z.enum(['high', 'moderate', 'low']),
  reason: z.string(),
});

export class BlockedError extends Error {}

interface Pricing { version: string | null; models: Record<string, { input: number; cached_input?: number; output: number }> }
export function loadPricing(): Pricing {
  return json<Pricing>(readFileSync(join(REPO_ROOT, 'apps/server/config/ai-pricing.json'), 'utf8'), { version: null, models: {} });
}

export function costUsd(p: Pricing, model: string, u: Usage): number | null {
  const m = p.models[model];
  if (!m) return null;
  const cached = Math.min(u.cachedTokens, u.inputTokens);
  return ((u.inputTokens - cached) * m.input + cached * (m.cached_input ?? m.input) + u.outputTokens * m.output) / 1_000_000;
}

/** Orçamento: limite de artigos/dia sempre; limite em USD quando configurado (exige tabela de preços). */
export function checkBudget(db: Db, cfg: Config, models: string[]) {
  const dayStart = new Date(Date.now() - 86_400_000).toISOString();
  const monthStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const analyzed = db.get<{ n: number }>("SELECT COUNT(DISTINCT article_id) AS n FROM ai_usage WHERE task = 'extraction' AND created_at > ?", dayStart)!.n;
  if (analyzed >= cfg.AI_MAX_ARTICLES_PER_DAY) throw new BlockedError(`Limite diário de ${cfg.AI_MAX_ARTICLES_PER_DAY} artigos analisados atingido.`);
  if (cfg.AI_DAILY_BUDGET_USD || cfg.AI_MONTHLY_BUDGET_USD) {
    const pricing = loadPricing();
    const missing = models.filter((m) => !pricing.models[m]);
    if (missing.length) throw new BlockedError(`Orçamento em USD configurado, mas ai-pricing.json não tem preço para: ${missing.join(', ')}.`);
    const day = db.get<{ s: number | null }>('SELECT SUM(cost_usd) AS s FROM ai_usage WHERE created_at > ?', dayStart)!.s ?? 0;
    const month = db.get<{ s: number | null }>('SELECT SUM(cost_usd) AS s FROM ai_usage WHERE created_at > ?', monthStart)!.s ?? 0;
    if (cfg.AI_DAILY_BUDGET_USD && day >= cfg.AI_DAILY_BUDGET_USD) throw new BlockedError(`Orçamento diário de IA (US$ ${cfg.AI_DAILY_BUDGET_USD}) atingido.`);
    if (cfg.AI_MONTHLY_BUDGET_USD && month >= cfg.AI_MONTHLY_BUDGET_USD) throw new BlockedError(`Orçamento mensal de IA (US$ ${cfg.AI_MONTHLY_BUDGET_USD}) atingido.`);
  }
}

function recordUsage(db: Db, task: string, model: string, u: Usage, status: string, jobId: string | null, articleId: string) {
  const p = loadPricing();
  db.run(
    'INSERT INTO ai_usage (id, job_id, article_id, task, model, prompt_version, input_tokens, cached_tokens, output_tokens, cost_usd, price_table_version, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id(), jobId, articleId, task, model, PROMPT_VERSION, u.inputTokens, u.cachedTokens, u.outputTokens, costUsd(p, model, u), p.version, status, nowIso(),
  );
}

export function buildDocument(article: { original_title: string; journal: string | null; publication_types: string; pub_date: string | null }, abstract: string): string {
  // Delimitadores explícitos: o conteúdo é dado não confiável.
  const clean = (s: string) => s.replace(/<\/?documento>/gi, '');
  return [
    '<documento>',
    `Título original: ${clean(article.original_title)}`,
    `Periódico: ${clean(article.journal ?? 'não informado')}`,
    `Tipos de publicação: ${json<string[]>(article.publication_types, []).join(', ')}`,
    `Data: ${article.pub_date ?? 'não informada'}`,
    'Abstract:',
    clean(abstract),
    '</documento>',
  ].join('\n');
}

export async function analyzeArticle(db: Db, cfg: Config, provider: AiProvider | null, articleId: string, jobId: string | null = null) {
  if (!provider || !cfg.OPENAI_ANALYSIS_MODEL || !cfg.OPENAI_EDITORIAL_MODEL) {
    throw new BlockedError('OPENAI_API_KEY e modelos não configurados: análise real desabilitada (modo demonstração).');
  }
  const art = db.get<{ original_title: string; journal: string | null; publication_types: string; pub_date: string | null; retraction_status: string; triage_status: string }>(
    'SELECT ar.original_title, j.title AS journal, ar.publication_types, ar.pub_date, ar.retraction_status, ar.triage_status FROM articles ar LEFT JOIN journals j ON j.id = ar.journal_id WHERE ar.id = ?', articleId,
  );
  if (!art) throw new BlockedError('Artigo inexistente.');
  if (art.retraction_status === 'retracted') throw new BlockedError('Artigo retratado: não analisado.');
  const src = db.get<{ abstract_text: string | null; license: string }>('SELECT abstract_text, license FROM article_sources WHERE article_id = ? ORDER BY retrieved_at DESC LIMIT 1', articleId);
  if (!src?.abstract_text) throw new BlockedError('Sem abstract autorizado: apenas metadados. Análise não solicitada.');

  const doc = buildDocument(art, src.abstract_text);
  const inputHash = sha256(`${PROMPT_VERSION}\n${doc}`);
  const existing = db.get<{ id: string }>('SELECT id FROM analyses WHERE article_id = ? AND input_hash = ?', articleId, inputHash);
  if (existing) return { analysisId: existing.id, status: 'skipped_existing' as const };
  if (art.triage_status === 'excluded') return { analysisId: null, status: 'excluded' as const };
  checkBudget(db, cfg, [cfg.OPENAI_ANALYSIS_MODEL, cfg.OPENAI_EDITORIAL_MODEL, ...(cfg.OPENAI_TRIAGE_MODEL ? [cfg.OPENAI_TRIAGE_MODEL] : [])]);

  // 0) Triagem barata: o tema é mesmo o foco? Evita gastar a análise cara com menções de passagem.
  if (cfg.OPENAI_TRIAGE_MODEL) {
    const topics = db.all<{ label_pt: string }>("SELECT t.label_pt FROM article_topics at JOIN topics t ON t.id = at.topic_id WHERE at.article_id = ? AND at.method = 'source_query'", articleId)
      .map((t) => t.label_pt);
    const tr = await provider.structured({
      model: cfg.OPENAI_TRIAGE_MODEL, system: TRIAGE, user: `<tema>${topics.join(', ') || 'clínica médica'}</tema>\n${doc}`, name: 'triage', schema: triageSchema, maxOutputTokens: 2000,
    });
    recordUsage(db, 'triage', cfg.OPENAI_TRIAGE_MODEL, tr.usage, tr.parsed ? 'ok' : 'invalid', jobId, articleId);
    // Triagem inválida não exclui: segue para análise (e revisão humana).
    if (tr.parsed?.topicFit === 'tangential') {
      db.run("UPDATE articles SET triage_status = 'excluded', triage_reason = ?, updated_at = ? WHERE id = ?", `Triagem IA (${cfg.OPENAI_TRIAGE_MODEL}): tema tangencial. ${tr.parsed.reason}`.slice(0, 500), nowIso(), articleId);
      return { analysisId: null, status: 'excluded' as const };
    }
    if (tr.parsed) {
      db.run("UPDATE articles SET triage_reason = ? WHERE id = ?", `Triagem IA: tema ${tr.parsed.topicFit}, relevância ${tr.parsed.clinicalRelevance}. ${tr.parsed.reason}`.slice(0, 500), articleId);
      // Tema secundário: menor confiança na atribuição temática.
      if (tr.parsed.topicFit === 'secondary') db.run("UPDATE article_topics SET confidence = 0.5 WHERE article_id = ? AND method = 'source_query'", articleId);
    }
  }

  // 1) Extração + avaliação crítica (modelo de maior capacidade)
  let extraction: AiAnalysis | null = null;
  let report = { errors: ['não executado'], warnings: [] as string[], flags: [] as AiAnalysis['reviewFlags'] };
  let note = '';
  for (let attempt = 1; attempt <= 2 && report.errors.length; attempt++) {
    const r = await provider.structured({
      model: cfg.OPENAI_ANALYSIS_MODEL, system: EXTRACTION, user: doc + note, name: 'article_analysis', schema: aiAnalysisSchema, maxOutputTokens: cfg.AI_MAX_OUTPUT_TOKENS,
    });
    recordUsage(db, 'extraction', cfg.OPENAI_ANALYSIS_MODEL, r.usage, r.parsed ? 'ok' : 'invalid', jobId, articleId);
    if (r.refusal) throw new BlockedError(`Modelo recusou: ${r.refusal.slice(0, 200)}`);
    if (!r.parsed) {
      report = { errors: [`Schema inválido: ${r.parseError}`], warnings: [], flags: [] };
    } else {
      extraction = r.parsed;
      report = validateAnalysis(r.parsed, doc, 'abstract_only');
    }
    note = `\n\n[Sistema] A tentativa anterior falhou na validação: ${report.errors.join(' | ').slice(0, 800)}. Corrija sem inventar dados.`;
  }
  const meta = { model: cfg.OPENAI_ANALYSIS_MODEL, promptVersion: PROMPT_VERSION, inputHash, isDemo: false };
  if (!extraction || report.errors.length) {
    if (!extraction) throw new BlockedError(`Extração inválida após 2 tentativas: ${report.errors.join('; ').slice(0, 400)}`);
    const aid = insertAnalysis(db, articleId, { ...extraction, reviewFlags: [...new Set([...report.flags, 'validation_failed' as const])] }, { ...meta, status: 'blocked', validation: [...report.errors, ...report.warnings] });
    return { analysisId: aid, status: 'blocked' as const };
  }

  // 2) Redação editorial baseada só na extração validada
  const extractionJson = JSON.stringify({ ...extraction, editorialHeadline: null, summary: null, inShort: null });
  const ed = await provider.structured({
    model: cfg.OPENAI_EDITORIAL_MODEL, system: EDITORIAL, user: `<extracao>\n${extractionJson}\n</extracao>`, name: 'editorial_text', schema: editorialSchema, maxOutputTokens: 1500,
  });
  recordUsage(db, 'editorial', cfg.OPENAI_EDITORIAL_MODEL, ed.usage, ed.parsed ? 'ok' : 'invalid', jobId, articleId);
  const edReport = ed.parsed ? validateEditorial(ed.parsed, extractionJson, doc) : { errors: [`Redação inválida: ${ed.parseError}`], warnings: [], flags: [] };
  const final: AiAnalysis = { ...extraction, ...(ed.parsed && !edReport.errors.length ? ed.parsed : {}), reviewFlags: report.flags };
  const problems = [...report.warnings, ...edReport.errors.map((e) => `Redação: ${e}`)];
  if (edReport.errors.length) final.reviewFlags = [...new Set([...final.reviewFlags, 'validation_failed' as const])];
  const aid = insertAnalysis(db, articleId, final, { ...meta, status: edReport.errors.length ? 'blocked' : 'in_review', validation: problems });
  return { analysisId: aid, status: edReport.errors.length ? ('blocked' as const) : ('in_review' as const) };
}
