/* global process */
// Servidor isolado para e2e: banco descartável, build de produção da web servido pela API.
import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

for (const f of ['data/e2e.db', 'data/e2e.db-wal', 'data/e2e.db-shm']) rmSync(f, { force: true });
const env = { ...process.env, NODE_ENV: 'test', PORT: '8799', DATABASE_URL: 'file:./data/e2e.db', ADMIN_EMAILS: 'editor-e2e@example.com', RANKING_MIN_READERS: '1' };
const p = spawn('npm', ['run', 'start', '-w', '@jm/server'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.on('SIGTERM', () => p.kill());
process.on('SIGINT', () => p.kill());
