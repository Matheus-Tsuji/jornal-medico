// Pipeline de análise: extração estruturada → validação → redação editorial → validação → fila editorial.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { aiAnalysisSchema, type AiAnalysis } from '@jm/contracts';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { REPO_ROOT, json } from '../db/index.ts';
import { id, nowIso, sha256 } from '../lib/util.ts';
import { alreadyAnalyzed, finalizeAnalysis } from '../modules/analyses.ts';
import type { AiProvider, Usage } from './provider.ts';
import { validateAnalysis } from './validator.ts';

const PROMPTS = join(REPO_ROOT, 'apps/server/src/ai/prompts');
export const PROMPT_VERSION = 'triage.v1+extraction.v2+editorial.v3';
const TRIAGE = readFileSync(join(PROMPTS, 'triage.v1.md'), 'utf8');
const EXTRACTION = readFileSync(join(PROMPTS, 'extraction.v2.md'), 'utf8');
const EDITORIAL = readFileSync(join(PROMPTS, 'editorial.v3.md'), 'utf8');

export const editorialSchema = z.strictObject({
  editorialHeadline: z.string().nullable(), summary: z.string().nullable(), inShort: z.string().nullable(), plainResult: z.string().nullable(),
});
export const triageSchema = z.strictObject({
  topicFit: z.enum(['central', 'secondary', 'tangential']),
  clinicalRelevance: z.enum(['high', 'moderate', 'low']),
  reason: z.string(),
});

export class BlockedError extends Error {}
/** Condição passageira (orçamento do dia, IA não configurada): o job é adiado e o ciclo diário tenta de novo. */
export class DeferError extends BlockedError {
  constructor(message: string, readonly retryInMs: number) {
    super(message);
  }
}
const SIX_HOURS = 6 * 3_600_000;

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
export function checkBudget(db: Db, cfg: Config, models: string[], jobId: string | null = null) {
  const dayStart = new Date(Date.now() - 86_400_000).toISOString();
  const monthStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const done = db.get<{ n: number }>("SELECT COUNT(DISTINCT article_id) AS n FROM ai_usage WHERE task = 'extraction' AND created_at > ?", dayStart)!.n;
  // Com o ciclo em paralelo, as outras análises em andamento que ainda não gravaram a extração contam como
  // reservadas; as que já gravaram estão em `done` (sem contar duas vezes).
  const inFlight = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM jobs WHERE type = 'analyze' AND status = 'running' AND lease_until > ? AND id <> ?
       AND json_extract(payload, '$.articleId') NOT IN (SELECT article_id FROM ai_usage WHERE task = 'extraction' AND created_at > ?)`,
    new Date().toISOString(), jobId ?? '', dayStart,
  )!.n;
  const analyzed = done + inFlight;
  if (analyzed >= cfg.AI_MAX_ARTICLES_PER_DAY) throw new DeferError(`Limite diário de ${cfg.AI_MAX_ARTICLES_PER_DAY} artigos analisados atingido; fica para o próximo ciclo.`, SIX_HOURS);
  if (cfg.AI_DAILY_BUDGET_USD || cfg.AI_MONTHLY_BUDGET_USD) {
    const pricing = loadPricing();
    const missing = models.filter((m) => !pricing.models[m]);
    if (missing.length) throw new BlockedError(`Orçamento em USD configurado, mas ai-pricing.json não tem preço para: ${missing.join(', ')}.`);
    const day = db.get<{ s: number | null }>('SELECT SUM(cost_usd) AS s FROM ai_usage WHERE created_at > ?', dayStart)!.s ?? 0;
    const month = db.get<{ s: number | null }>('SELECT SUM(cost_usd) AS s FROM ai_usage WHERE created_at > ?', monthStart)!.s ?? 0;
    if (cfg.AI_DAILY_BUDGET_USD && day >= cfg.AI_DAILY_BUDGET_USD) throw new DeferError(`Orçamento diário de IA (US$ ${cfg.AI_DAILY_BUDGET_USD}) atingido.`, SIX_HOURS);
    if (cfg.AI_MONTHLY_BUDGET_USD && month >= cfg.AI_MONTHLY_BUDGET_USD) throw new DeferError(`Orçamento mensal de IA (US$ ${cfg.AI_MONTHLY_BUDGET_USD}) atingido.`, 4 * SIX_HOURS);
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

export async function analyzeArticle(db: Db, cfg: Config, provider: AiProvider | null, articleId: string, jobId: string | null = null, opts: { retry?: boolean } = {}) {
  if (!provider || !cfg.OPENAI_ANALYSIS_MODEL || !cfg.OPENAI_EDITORIAL_MODEL) {
    // Adiado, não bloqueado: quando a chave for configurada, a fila acumulada é analisada sozinha.
    throw new DeferError('OPENAI_API_KEY e modelos não configurados: análise real aguardando configuração.', SIX_HOURS);
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
  const existing = alreadyAnalyzed(db, articleId, inputHash, opts.retry);
  if (existing) return { analysisId: existing, status: 'skipped_existing' as const };
  if (art.triage_status === 'excluded') return { analysisId: null, status: 'excluded' as const };
  checkBudget(db, cfg, [cfg.OPENAI_ANALYSIS_MODEL, cfg.OPENAI_EDITORIAL_MODEL, ...(cfg.OPENAI_TRIAGE_MODEL ? [cfg.OPENAI_TRIAGE_MODEL] : [])], jobId);

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

  // 1) Extração + avaliação crítica (modelo de maior capacidade). Guarda a extração junto com o próprio relatório:
  // se a 2ª tentativa vier com schema inválido, vale a 1ª (e os erros dela), não uma mistura das duas.
  let best: { extraction: AiAnalysis; errors: string[] } | null = null;
  let schemaError = '';
  let note = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await provider.structured({
      model: cfg.OPENAI_ANALYSIS_MODEL, system: EXTRACTION, user: doc + note, name: 'article_analysis', schema: aiAnalysisSchema, maxOutputTokens: cfg.AI_MAX_OUTPUT_TOKENS,
    });
    recordUsage(db, 'extraction', cfg.OPENAI_ANALYSIS_MODEL, r.usage, r.parsed ? 'ok' : 'invalid', jobId, articleId);
    if (r.refusal) throw new BlockedError(`Modelo recusou: ${r.refusal.slice(0, 200)}`);
    const errors = r.parsed ? validateAnalysis(r.parsed, doc, 'abstract_only').errors : [`Schema inválido: ${r.parseError}`];
    if (r.parsed) best = { extraction: r.parsed, errors };
    else schemaError = errors[0]!;
    if (r.parsed && !errors.length) break;
    note = `\n\n[Sistema] A tentativa anterior falhou na validação: ${errors.join(' | ').slice(0, 800)}. Corrija sem inventar dados.`;
  }
  if (!best) throw new BlockedError(`Extração inválida após 2 tentativas: ${schemaError.slice(0, 400)}`);
  const meta = { model: cfg.OPENAI_ANALYSIS_MODEL, promptVersion: PROMPT_VERSION, inputHash };
  if (best.errors.length) {
    const r = finalizeAnalysis(db, articleId, best.extraction, { error: 'não executada (extração bloqueada)' }, doc, meta);
    return { analysisId: r.analysisId, status: r.status };
  }

  // 2) Redação editorial baseada só na extração validada
  const extractionJson = JSON.stringify({ ...best.extraction, editorialHeadline: null, summary: null, inShort: null, plainResult: null });
  const ed = await provider.structured({
    model: cfg.OPENAI_EDITORIAL_MODEL, system: EDITORIAL, user: `<extracao>\n${extractionJson}\n</extracao>`, name: 'editorial_text', schema: editorialSchema, maxOutputTokens: 1500,
  });
  recordUsage(db, 'editorial', cfg.OPENAI_EDITORIAL_MODEL, ed.usage, ed.parsed ? 'ok' : 'invalid', jobId, articleId);
  const r = finalizeAnalysis(db, articleId, best.extraction, ed.parsed ?? { error: ed.parseError ?? 'sem resposta' }, doc, meta);
  return { analysisId: r.analysisId, status: r.status };
}
