// Processo worker: agenda e executa jobs. Pode reiniciar sem duplicar trabalho (leases + idempotência).
import { hostname } from 'node:os';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { sleep } from '../lib/util.ts';
import { defaultDeps, log, schedule, workOnce } from './runner.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN);
const deps = defaultDeps(cfg);
const workerId = `${hostname()}:${process.pid}`;
let running = true;
process.on('SIGINT', () => (running = false));
process.on('SIGTERM', () => (running = false));
log('worker_started', { workerId, ai: deps.provider ? 'openai' : 'desabilitada (sem OPENAI_API_KEY)' });

let lastSchedule = 0;
while (running) {
  if (Date.now() - lastSchedule > 60_000) {
    schedule(db, cfg);
    lastSchedule = Date.now();
  }
  const worked = await workOnce(db, cfg, deps, workerId);
  if (!worked) await sleep(5_000);
}
db.close();
log('worker_stopped');
