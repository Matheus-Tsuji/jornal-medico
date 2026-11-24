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
let backoff = 30_000;
while (running) {
  try {
    const r = await runCycle(db, cfg, deps, { workerId, budgetMs: 60_000, concurrency: cfg.CYCLE_CONCURRENCY });
    backoff = 30_000;
    if (!r.processed) await sleep(30_000);
  } catch (e) {
    // Nunca derruba o processo: registra e tenta de novo com espera crescente (até 10 min).
    log('cycle_error', { error: (e instanceof Error ? e.message : String(e)).slice(0, 300), retryInMs: backoff });
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 600_000);
  }
}
db.close();
log('worker_stopped');
