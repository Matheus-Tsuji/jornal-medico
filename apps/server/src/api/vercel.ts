// Entrada da Vercel: a mesma API Fastify como função Node, mais o cron que substitui o processo worker.
// O empacotamento (scripts/build-vercel.mjs) transforma este arquivo em .vercel/output/functions/api.func/index.mjs.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { defaultDeps, log, schedule, workOnce } from '../worker/runner.ts';
import { buildApp } from './app.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN);
let app: Promise<FastifyInstance> | null = null;

// Margem para terminar o job em curso antes do limite da função (maxDuration em build-vercel.mjs).
const CRON_BUDGET_MS = 240_000;

function cronAuthorized(header: string | undefined): boolean {
  if (!cfg.CRON_SECRET || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${cfg.CRON_SECRET}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function cron(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json');
  if (!cronAuthorized(req.headers.authorization)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ code: 'unauthorized' }));
    return;
  }
  const started = Date.now();
  schedule(db, cfg);
  const deps = defaultDeps(cfg);
  let processed = 0;
  while (Date.now() - started < CRON_BUDGET_MS && (await workOnce(db, cfg, deps, `vercel:${process.pid}`))) processed++;
  log('cron_tick', { processed, ms: Date.now() - started });
  res.end(JSON.stringify({ ok: true, processed }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url?.startsWith('/api/v1/cron/tick')) return cron(req, res);
  const a = await (app ??= buildApp({ db, cfg }).then(async (x) => (await x.ready(), x)));
  a.server.emit('request', req, res);
}
