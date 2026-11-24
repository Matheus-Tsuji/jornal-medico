// Execução de jobs: despacho por tipo e classificação de falhas.
import { purgeAuthData } from '../modules/auth.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { TransientError, type FetchLike } from '../lib/net.ts';
import { localDate, localTime, nowIso, sleep } from '../lib/util.ts';
import { analyzeArticle, BlockedError, DeferError } from '../ai/analysis.ts';
import { openAiProvider, type AiProvider } from '../ai/provider.ts';
import { composeEdition } from '../modules/editorial.ts';
import { LEASE_MS, block, claim, complete, defer, enqueue, expireStaleAnalyses, fail, heartbeat, retryLater, type Job } from '../modules/jobs.ts';
import { pubmedAdapter, type ScientificSourceAdapter } from '../sources/pubmed.ts';
import { europePmcAdapter } from '../sources/europepmc.ts';
import { scieloAdapter } from '../sources/scielo.ts';
import { automaticSources, syncMonitor } from '../modules/monitor.ts';
import { discover, upsertRecord } from './ingestion.ts';

/** adapter = PubMed (busca e recheck de retratações); extraAdapters = outras fontes científicas, só busca. */
export interface Deps { adapter: ScientificSourceAdapter; extraAdapters?: ScientificSourceAdapter[]; provider: AiProvider | null; monitorFetch?: FetchLike; recheckBatch?: number }

export const defaultDeps = (cfg: Config): Deps => ({
  adapter: pubmedAdapter(cfg),
  extraAdapters: [europePmcAdapter(), scieloAdapter()],
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
      // Revisita artigos reais recentes para captar retratações/correções. Rodízio: nunca conferidos primeiro, depois
      // os conferidos há mais tempo; o marcador é gravado a cada lote, então todos passam por aqui em ciclos sucessivos.
      const rows = db.all<{ id: string; pmid: string; topic_id: string; source_id: string }>(
        `SELECT ar.id, ar.pmid, MIN(at.topic_id) AS topic_id, ar.source_id FROM articles ar JOIN article_topics at ON at.article_id = ar.id
          WHERE ar.is_demo = 0 AND ar.pmid IS NOT NULL AND ar.created_at > ? GROUP BY ar.id
          ORDER BY ar.retraction_checked_at IS NOT NULL, ar.retraction_checked_at, ar.id LIMIT ?`,
        new Date(Date.now() - 180 * 86_400_000).toISOString(), deps.recheckBatch ?? RECHECK_BATCH,
      );
      if (!rows.length) return { checked: 0, retracted: 0 };
      const recs = await deps.adapter.fetchDetails(rows.map((r) => r.pmid));
      const checkedAt = nowIso();
      db.tx(() => rows.forEach((r) => db.run('UPDATE articles SET retraction_checked_at = ? WHERE id = ?', checkedAt, r.id)));
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

export const RECHECK_BATCH = 500;
const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/** Executa um job da fila; devolve o tipo do job executado, ou false se não havia nada pronto. */
export async function workOnce(db: Db, cfg: Config, deps: Deps, workerId: string, leaseMs = LEASE_MS): Promise<Job['type'] | false> {
  const job = claim(db, workerId, leaseMs);
  if (!job) return false;
  if (job.invalid) {
    fail(db, job, job.invalid);
    log('job_error', { jobId: job.id, type: job.type, error: job.invalid });
    return job.type;
  }
  // Heartbeat: análises longas não perdem o lease no meio (e outro worker não pega o mesmo job).
  const beat = setInterval(() => {
    try {
      heartbeat(db, job, leaseMs);
    } catch (e) {
      log('heartbeat_error', { jobId: job.id, error: toError(e).message.slice(0, 200) });
    }
  }, Math.max(1_000, leaseMs / 3));
  try {
    complete(db, job, await runJob(db, cfg, job, deps));
  } catch (e) {
    const err = toError(e);
    try {
      if (err instanceof DeferError) defer(db, job, err.message, err.retryInMs);
      else if (err instanceof BlockedError) block(db, job, err.message);
      else if (err instanceof TransientError) retryLater(db, job, err.message, err.retryAfterMs);
      else fail(db, job, err.message);
    } catch (e2) {
      // Falha ao gravar o estado (ex.: banco instável): o lease vence e o job volta sozinho.
      log('job_state_error', { jobId: job.id, error: toError(e2).message.slice(0, 300) });
    }
    log('job_error', { jobId: job.id, type: job.type, error: err.message.slice(0, 300) });
  } finally {
    clearInterval(beat);
  }
  return job.type;
}

export interface CycleResult { processed: number; byType: Record<string, number>; pending: number; ms: number }

/**
 * Ciclo diário autônomo: agenda (buscas nas fontes, monitor, recheck, composição) e trabalha a fila até esvaziar
 * ou acabar o tempo. Vários jobs em paralelo: buscas e análises passam a maior parte do tempo esperando a rede.
 * O que não couber fica na fila (com lease e idempotência) e o próximo ciclo continua de onde parou.
 * Erros de infraestrutura (banco instável) são registrados e encerram só a lane afetada, nunca o processo.
 */
export async function runCycle(db: Db, cfg: Config, deps: Deps, opts: { workerId: string; budgetMs: number; concurrency?: number; now?: Date }): Promise<CycleResult> {
  const started = Date.now();
  try {
    purgeAuthData(db);
    schedule(db, cfg, opts.now);
  } catch (e) {
    log('schedule_error', { error: toError(e).message.slice(0, 300) });
  }
  const byType: Record<string, number> = {};
  let processed = 0;
  const lane = async (n: number) => {
    let errors = 0;
    while (Date.now() - started < opts.budgetMs) {
      let type: Job['type'] | false;
      try {
        type = await workOnce(db, cfg, deps, `${opts.workerId}#${n}`);
      } catch (e) {
        log('lane_error', { lane: n, error: toError(e).message.slice(0, 300) });
        if (++errors >= 3) return;
        await sleep(500 * errors);
        continue;
      }
      if (!type) return;
      processed++;
      byType[type] = (byType[type] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, (_, i) => lane(i)));
  let pending = -1;
  try {
    pending = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','retry','running')")!.n;
  } catch (e) {
    log('pending_error', { error: toError(e).message.slice(0, 300) });
  }
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
