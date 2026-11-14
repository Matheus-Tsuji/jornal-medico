import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { openDb, REPO_ROOT } from './index.ts';
import { seed } from './seed.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN);
const cmd = process.argv[2];
if (cmd === 'migrate') console.log('Migrações aplicadas.');
else if (cmd === 'seed') console.log('Semente aplicada:', seed(db, cfg));
else if (cmd === 'backup') {
  // VACUUM INTO gera cópia consistente mesmo com WAL ativo.
  const dir = join(REPO_ROOT, 'data/backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `journal-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log('Backup criado em', file);
} else if (cmd === 'export-clean') {
  // Cópia para subir no Turso (produção): sem sessões, códigos de login nem a caixa postal de desenvolvimento.
  const file = join(REPO_ROOT, 'data/export-producao.db');
  rmSync(file, { force: true });
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const x = openDb(file);
  x.raw.exec("DELETE FROM sessions; DELETE FROM auth_challenges; DELETE FROM dev_outbox; UPDATE jobs SET status = 'queued', locked_by = NULL, lease_until = NULL WHERE status = 'running'; PRAGMA journal_mode = DELETE;");
  x.close();
  console.log('Cópia limpa em', file);
} else if (cmd === 'restore-check') {
  // Restaura a cópia num arquivo separado e confere integridade.
  const tmp = join(REPO_ROOT, 'data/backups/restore-check.db');
  copyFileSync(process.argv[3] ?? '', tmp);
  const r = openDb(tmp);
  console.log('Restore OK:', r.get('SELECT COUNT(*) AS articles FROM articles'), r.get('PRAGMA integrity_check'));
  r.close();
}
db.close();
