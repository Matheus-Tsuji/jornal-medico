// Execução de jobs: despacho por tipo e classificação de falhas.
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { TransientError, type FetchLike } from '../lib/net.ts';
import { localDate, localTime } from '../lib/util.ts';
import { analyzeArticle, BlockedError, DeferError } from '../ai/analysis.ts';
import { openAiProvider, type AiProvider } from '../ai/provider.ts';
import { composeEdition } from '../modules/editorial.ts';
import { block, claim, complete, defer, enqueue, expireStaleAnalyses, fail, retryLater, type Job } from '../modules/jobs.ts';
import { pubmedAdapter, type ScientificSourceAdapter } from '../sources/pubmed.ts';
import { europePmcAdapter } from '../sources/europepmc.ts';
import { automaticSources, syncMonitor } from '../modules/monitor.ts';
import { discover, upsertRecord } from './ingestion.ts';

/** adapter = PubMed (busca e recheck de retratações); extraAdapters = outras fontes científicas, só busca. */
export interface Deps { adapter: ScientificSourceAdapter; extraAdapters?: ScientificSourceAdapter[]; provider: AiProvider | null; monitorFetch?: FetchLike }

export const defaultDeps = (cfg: Config): Deps => ({
  adapter: pubmedAdapter(cfg),
  extraAdapters: [europePmcAdapter()],
  provider: cfg.OPENAI_API_KEY ? openAiProvider(cfg.OPENAI_API_KEY) : null,
});

export async function runJob(db: Db, cfg: Config, job: Job, deps: Deps): Promise<unknown> {
  const p = job.payload as Record<string, string>;
  switch (job.type) {
    case 'monitor':
      return syncMonitor(db, p.source!, deps.monitorFetch);
    case 'discover': {
      const adapter = !p.source || p.source === deps.adapter.slug ? deps.adapter : deps.extraAdapters?.find((a) => a.slug === p.source);
      if (!adapter) return { skipped: `sem adaptador para ${p.source}` };
      return discover(db, cfg, adapter, p.topic!, job.id);
    }
    case 'analyze':
      return analyzeArticle(db, cfg, deps.provider, p.articleId!, job.id);
    case 'compose':
      return composeEdition(db, p.date!);
    case 'recheck': {
      // Revisita artigos reais recentes para captar retratações/correções.
      const rows = db.all<{ pmid: string; topic_id: string; source_id: string }>(
        `SELECT ar.pmid, MIN(at.topic_id) AS topic_id, ar.source_id FROM articles ar JOIN article_topics at ON at.article_id = ar.id
          WHERE ar.is_demo = 0 AND ar.pmid IS NOT NULL AND ar.created_at > ? GROUP BY ar.id LIMIT 500`,
        new Date(Date.now() - 180 * 86_400_000).toISOString(),
      );
      if (!rows.length) return { checked: 0, retracted: 0 };
      const recs = await deps.adapter.fetchDetails(rows.map((r) => r.pmid));
      let retracted = 0;
      for (const r of recs) {
        const row = rows.find((x) => x.pmid === r.pmid);
        if (!row) continue;
        upsertRecord(db, row.source_id, row.topic_id, r);
        if (r.retracted) retracted++;
      }
      return { checked: recs.length, retracted };
    }
  }
}

/** Executa um job da fila; devolve o tipo do job executado, ou false se não havia nada pronto. */
export async function workOnce(db: Db, cfg: Config, deps: Deps, workerId: string): Promise<Job['type'] | false> {
  const job = claim(db, workerId);
  if (!job) return false;
  try {
    complete(db, job.id, await runJob(db, cfg, job, deps));
  } catch (e) {
    const err = e as Error;
    if (err instanceof DeferError) defer(db, job, err.message, err.retryInMs);
    else if (err instanceof BlockedError) block(db, job.id, err.message);
    else if (err instanceof TransientError) retryLater(db, job, err.message, err.retryAfterMs);
    else fail(db, job.id, err.message);
    log('job_error', { jobId: job.id, type: job.type, error: err.message.slice(0, 300) });
  }
  return job.type;
}

export interface CycleResult { processed: number; byType: Record<string, number>; pending: number; ms: number }

/**
 * Ciclo diário autônomo: agenda (buscas nas fontes, monitor, recheck, composição) e trabalha a fila até esvaziar
 * ou acabar o tempo. Vários jobs em paralelo: buscas e análises passam a maior parte do tempo esperando a rede.
 * O que não couber fica na fila (com lease e idempotência) e o próximo ciclo continua de onde parou.
 */
export async function runCycle(db: Db, cfg: Config, deps: Deps, opts: { workerId: string; budgetMs: number; concurrency?: number; now?: Date }): Promise<CycleResult> {
  const started = Date.now();
  schedule(db, cfg, opts.now);
  const byType: Record<string, number> = {};
  let processed = 0;
  const lane = async (n: number) => {
    while (Date.now() - started < opts.budgetMs) {
      const type = await workOnce(db, cfg, deps, `${opts.workerId}#${n}`);
      if (!type) return;
      processed++;
      byType[type] = (byType[type] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, (_, i) => lane(i)));
  const pending = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','retry','running')")!.n;
  const result = { processed, byType, pending, ms: Date.now() - started };
  log('cycle_done', { ...result });
  return result;
}

/** Agenda descobertas (4 janelas/dia), composição 1h antes da edição e recheck diário. */
export function schedule(db: Db, cfg: Config, now = new Date()) {
  expireStaleAnalyses(db, cfg.ANALYZE_MAX_AGE_DAYS);
  const date = localDate(cfg.APP_TIMEZONE, now);
  const hhmm = localTime(cfg.APP_TIMEZONE, now);
  const slot = Math.floor(Number(hhmm.slice(0, 2)) / 6);
  for (const source of automaticSources) enqueue(db, 'monitor', `monitor:${source}:${date}:${slot}`, { source });
  const topics = db.all<{ slug: string }>("SELECT slug FROM topics WHERE enabled = 1 AND source_query IS NOT NULL");
  for (const t of topics) enqueue(db, 'discover', `discover:pubmed:${t.slug}:${date}:${slot}`, { topic: t.slug });
  // Outras fontes científicas: 1 vez por dia por tema (o volume fora do PubMed é pequeno).
  const extra = db.all<{ slug: string }>("SELECT slug FROM sources WHERE enabled = 1 AND kind = 'bibliographic_api' AND slug <> 'pubmed'");
  for (const s of extra) for (const t of topics) enqueue(db, 'discover', `discover:${s.slug}:${t.slug}:${date}`, { topic: t.slug, source: s.slug });
  const [h, m] = cfg.EDITION_HOUR.split(':').map(Number) as [number, number];
  const composeAt = `${String(Math.max(0, h - 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (hhmm >= composeAt) enqueue(db, 'compose', `compose:${date}`, { date });
  enqueue(db, 'recheck', `recheck:${date}`, {});
}

export const log = (event: string, data: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level: 'info', svc: 'worker', event, ...data }) + '\n');
