/* global process */
// Sobe API (8787) e web (5173) juntos. Ctrl+C encerra os dois.
import { spawn } from 'node:child_process';

const run = (args) => spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run(['run', 'dev', '-w', '@jm/server']), run(['run', 'dev', '-w', '@jm/web'])];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
