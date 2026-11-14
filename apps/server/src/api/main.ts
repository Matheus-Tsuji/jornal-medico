import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { seed } from '../db/seed.ts';
import { buildApp } from './app.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN);
// Conveniência local: popula taxonomia/demonstração num banco vazio (nunca em produção).
if (cfg.NODE_ENV !== 'production' && !db.get('SELECT 1 FROM topics LIMIT 1')) seed(db, cfg);
const app = await buildApp({ db, cfg });
await app.listen({ port: cfg.PORT, host: cfg.HOST });

const stop = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
