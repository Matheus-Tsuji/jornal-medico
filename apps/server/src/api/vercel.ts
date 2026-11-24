// Entrada da Vercel: a mesma API Fastify como função Node, mais o cron que substitui o processo worker.
// O empacotamento (scripts/build-vercel.mjs) transforma este arquivo em .vercel/output/functions/api.func/index.mjs.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSecrets, loadConfig } from '../config.ts';
import { REPO_ROOT, isRemote, openDb } from '../db/index.ts';
import { defaultDeps, runCycle } from '../worker/runner.ts';
import { buildApp } from './app.ts';
import { safeEqual } from '../lib/util.ts';

// Na Vercel, fora de produção haveria segredos fixos de desenvolvimento e caixa postal com códigos: recusa subir.
if (process.env.VERCEL && process.env.NODE_ENV !== 'production') throw new Error('Na Vercel, NODE_ENV precisa ser "production".');
const cfg = loadConfig();
for (const w of cfg.warnings) console.warn(JSON.stringify({ level: 'warn', msg: w }));
// Sem Turso configurado, roda numa "vitrine": cópia do banco embutida no deploy (sem dados pessoais), copiada
// para /tmp, o único lugar gravável. Funciona, mas o que os leitores salvam se perde quando a instância recicla.
function vitrine(): string {
  const tmp = join(tmpdir(), 'jornal-vitrine.db');
  if (!existsSync(tmp)) copyFileSync(join(REPO_ROOT, 'apps/server/data/vitrine.db'), tmp);
  cfg.ephemeral = true;
  console.warn(JSON.stringify({ level: 'warn', msg: 'Modo vitrine efêmera (/tmp): sem Turso, dados de leitores se perdem e o ciclo diário fica desligado.' }));
  return tmp;
}
const db = isRemote(cfg.dbPath) ? openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN) : openDb(vitrine());
ensureSecrets(db, cfg);
let app: Promise<FastifyInstance> | null = null;

// Para de pegar jobs novos aos 180 s: no ciclo real de 2026-11-16 as análises em curso terminaram até 74 s depois
// do corte, e a função morre aos 300 s (maxDuration em build-vercel.mjs). Se morrer mesmo assim, o lease expira
// e o próximo ciclo retoma o job.
const CRON_BUDGET_MS = 180_000;

const cronAuthorized = (header: string | undefined) => !!cfg.CRON_SECRET && !!header && safeEqual(header, `Bearer ${cfg.CRON_SECRET}`);

async function cron(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json');
  if (!cronAuthorized(req.headers.authorization)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ code: 'unauthorized' }));
    return;
  }
  if (cfg.ephemeral) {
    // Na vitrine o banco some quando a instância recicla: buscar e analisar aqui seria trabalho (e custo) perdido.
    res.statusCode = 409;
    res.end(JSON.stringify({ code: 'needs_database', message: 'Ciclo diário desligado na vitrine: conecte o Turso (docs/deploy-vercel.md).' }));
    return;
  }
  const result = await runCycle(db, cfg, defaultDeps(cfg), { workerId: `vercel:${process.pid}`, budgetMs: CRON_BUDGET_MS, concurrency: cfg.CYCLE_CONCURRENCY });
  res.end(JSON.stringify({ ok: true, ...result }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.url?.startsWith('/api/v1/cron/tick')) return cron(req, res);
  const a = await (app ??= buildApp({ db, cfg }).then(async (x) => (await x.ready(), x)));
  a.server.emit('request', req, res);
}
