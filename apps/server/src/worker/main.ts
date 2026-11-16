// Processo worker: agenda e executa jobs. Pode reiniciar sem duplicar trabalho (leases + idempotência).
import { hostname } from 'node:os';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { sleep } from '../lib/util.ts';
import { defaultDeps, log, runCycle } from './runner.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN);
const deps = defaultDeps(cfg);
const workerId = `${hostname()}:${process.pid}`;
let running = true;
process.on('SIGINT', () => (running = false));
process.on('SIGTERM', () => (running = false));
log('worker_started', { workerId, ai: deps.provider ? 'openai' : 'desabilitada (sem OPENAI_API_KEY)' });

// Mesmo ciclo do cron da Vercel, repetido: agenda (idempotente por data e janela de 6 h) e trabalha a fila.
while (running) {
  const r = await runCycle(db, cfg, deps, { workerId, budgetMs: 60_000, concurrency: cfg.CYCLE_CONCURRENCY });
  if (!r.processed) await sleep(30_000);
}
db.close();
log('worker_stopped');
