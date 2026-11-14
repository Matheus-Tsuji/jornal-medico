// Execução de jobs: despacho por tipo e classificação de falhas.
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { TransientError } from '../lib/net.ts';
import { localDate, localTime } from '../lib/util.ts';
import { analyzeArticle, BlockedError } from '../ai/analysis.ts';
import { openAiProvider, type AiProvider } from '../ai/provider.ts';
import { composeEdition } from '../modules/editorial.ts';
import { block, claim, complete, enqueue, fail, retryLater, type Job } from '../modules/jobs.ts';
import { pubmedAdapter, type ScientificSourceAdapter } from '../sources/pubmed.ts';
import { automaticSources, syncMonitor } from '../modules/monitor.ts';
import { discover, upsertRecord } from './ingestion.ts';

export interface Deps { adapter: ScientificSourceAdapter; provider: AiProvider | null }

export const defaultDeps = (cfg: Config): Deps => ({
  adapter: pubmedAdapter(cfg),
  provider: cfg.OPENAI_API_KEY ? openAiProvider(cfg.OPENAI_API_KEY) : null,
});

export async function runJob(db: Db, cfg: Config, job: Job, deps: Deps): Promise<unknown> {
  const p = job.payload as Record<string, string>;
  switch (job.type) {
    case 'monitor':
      return syncMonitor(db, p.source!);
    case 'discover':
      return discover(db, cfg, deps.adapter, p.topic!, job.id);
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

export async function workOnce(db: Db, cfg: Config, deps: Deps, workerId: string): Promise<boolean> {
  const job = claim(db, workerId);
  if (!job) return false;
  try {
    complete(db, job.id, await runJob(db, cfg, job, deps));
  } catch (e) {
    const err = e as Error;
    if (err instanceof BlockedError) block(db, job.id, err.message);
    else if (err instanceof TransientError) retryLater(db, job, err.message, err.retryAfterMs);
    else fail(db, job.id, err.message);
    log('job_error', { jobId: job.id, type: job.type, error: err.message.slice(0, 300) });
  }
  return true;
}

/** Agenda descobertas (4 janelas/dia), composição 1h antes da edição e recheck diário. */
export function schedule(db: Db, cfg: Config, now = new Date()) {
  const date = localDate(cfg.APP_TIMEZONE, now);
  const hhmm = localTime(cfg.APP_TIMEZONE, now);
  const slot = Math.floor(Number(hhmm.slice(0, 2)) / 6);
  for (const source of automaticSources) enqueue(db, 'monitor', `monitor:${source}:${date}:${slot}`, { source });
  const topics = db.all<{ slug: string }>("SELECT slug FROM topics WHERE enabled = 1 AND source_query IS NOT NULL");
  for (const t of topics) enqueue(db, 'discover', `discover:pubmed:${t.slug}:${date}:${slot}`, { topic: t.slug });
  const [h, m] = cfg.EDITION_HOUR.split(':').map(Number) as [number, number];
  const composeAt = `${String(Math.max(0, h - 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (hhmm >= composeAt) enqueue(db, 'compose', `compose:${date}`, { date });
  enqueue(db, 'recheck', `recheck:${date}`, {});
}

export const log = (event: string, data: Record<string, unknown> = {}) =>
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level: 'info', svc: 'worker', event, ...data }) + '\n');
