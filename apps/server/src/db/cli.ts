import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.ts';
import { copyDb } from './copy.ts';
import { isRemote, openDb, REPO_ROOT } from './index.ts';
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
  // --vitrine: versão embutida no deploy da Vercel quando ainda não há Turso; vai para o Git, então sai sem
  // nenhum dado de pessoa (usuários, leitura, salvos, avaliações, auditoria) nem a fila de jobs.
  const vitrine = process.argv.includes('--vitrine');
  const file = join(REPO_ROOT, vitrine ? 'apps/server/data/vitrine.db' : 'data/export-producao.db');
  mkdirSync(dirname(file), { recursive: true });
  rmSync(file, { force: true });
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const x = openDb(file);
  x.raw.exec("DELETE FROM sessions; DELETE FROM auth_challenges; DELETE FROM dev_outbox; DELETE FROM app_secrets; UPDATE jobs SET status = 'queued', locked_by = NULL, lease_until = NULL WHERE status = 'running';");
  if (vitrine) {
    x.raw.exec(`PRAGMA foreign_keys = OFF;
      DELETE FROM user_preferences; DELETE FROM bookmarks; DELETE FROM read_events; DELETE FROM feedback; DELETE FROM error_reports;
      DELETE FROM subscriptions; DELETE FROM billing_events; DELETE FROM editorial_reviews; DELETE FROM audit_events; DELETE FROM users;
      DELETE FROM jobs; DELETE FROM ingestion_runs; DELETE FROM ai_usage;`);
  }
  x.raw.exec('PRAGMA journal_mode = DELETE; VACUUM;');
  x.close();
  console.log('Cópia limpa em', file);
} else if (cmd === 'push-remote') {
  // Sobe a cópia limpa para o Turso. Endereço e token vêm do .env (PUSH_DATABASE_URL / PUSH_DATABASE_AUTH_TOKEN),
  // nunca da linha de comando, para não aparecerem no histórico.
  const url = process.env.PUSH_DATABASE_URL;
  if (!url || !isRemote(url)) throw new Error('Defina no .env PUSH_DATABASE_URL (libsql://…) e PUSH_DATABASE_AUTH_TOKEN do banco Turso.');
  const file = join(REPO_ROOT, 'data/export-producao.db');
  if (!existsSync(file)) throw new Error('Rode antes: npm run db:export');
  const dst = openDb(url, process.env.PUSH_DATABASE_AUTH_TOKEN);
  if (dst.get('SELECT 1 FROM analyses WHERE is_demo = 0 LIMIT 1') && !process.argv.includes('--substituir')) {
    throw new Error('O banco remoto já tem análises reais. Para apagar e substituir, rode de novo com --substituir.');
  }
  const src = openDb(file);
  copyDb(src, dst, (m) => console.log('  ', m));
  console.log('Dados enviados ao Turso:', dst.get('SELECT COUNT(*) AS analises FROM analyses'));
  src.close();
  dst.close();
} else if (cmd === 'restore-check') {
  // Restaura a cópia num arquivo separado e confere integridade.
  const tmp = join(REPO_ROOT, 'data/backups/restore-check.db');
  copyFileSync(process.argv[3] ?? '', tmp);
  const r = openDb(tmp);
  console.log('Restore OK:', r.get('SELECT COUNT(*) AS articles FROM articles'), r.get('PRAGMA integrity_check'));
  r.close();
}
db.close();
