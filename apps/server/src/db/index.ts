// Acesso ao SQLite via libsql (API síncrona compatível com better-sqlite3). Todas as consultas usam parâmetros.
// Local: arquivo (DATABASE_URL=file:./data/journal.db). Vercel: Turso remoto (DATABASE_URL=libsql://… + DATABASE_AUTH_TOKEN).
import Database from 'libsql';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// JM_ROOT: no pacote da Vercel o código vira um arquivo só; a raiz dos arquivos de dados é informada pelo empacotador.
export const REPO_ROOT = process.env.JM_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/server/src/db/migrations');

export type Row = Record<string, unknown>;
export type Params = (null | number | bigint | string | Uint8Array)[];

export const isRemote = (url: string) => /^(libsql|https?|wss?):\/\//.test(url);
// libsql acrescenta _metadata (duração da consulta) em cada linha; não deve vazar para a API.
const clean = <T>(r: unknown): T => {
  if (r && typeof r === 'object') delete (r as Row)._metadata;
  return r as T;
};

export class Db {
  readonly raw: Database.Database;
  private readonly statements = new Map<string, Database.Statement<Params>>();
  constructor(path: string, authToken?: string) {
    if (isRemote(path)) {
      // authToken é aceito pela conexão remota (libsql/index.js), mas falta nos tipos publicados.
      this.raw = new Database(path, { authToken } as Database.Options);
      this.raw.exec('PRAGMA foreign_keys = ON;');
      return;
    }
    const file = path === ':memory:' || isAbsolute(path) ? path : resolve(REPO_ROOT, path);
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.raw = new Database(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -16000;');
  }
  // Reutiliza apenas o SQL compilado. Cada execução consulta os dados atuais.
  private prepare(sql: string) {
    const cached = this.statements.get(sql);
    if (cached) {
      this.statements.delete(sql);
      this.statements.set(sql, cached);
      return cached;
    }
    const statement = this.raw.prepare<Params>(sql);
    if (this.statements.size >= 128) this.statements.delete(this.statements.keys().next().value!);
    this.statements.set(sql, statement);
    return statement;
  }
  get<T = Row>(sql: string, ...params: Params): T | undefined {
    return clean<T | undefined>(this.prepare(sql).get(...params));
  }
  all<T = Row>(sql: string, ...params: Params): T[] {
    return (this.prepare(sql).all(...params) as unknown[]).map((r) => clean<T>(r));
  }
  run(sql: string, ...params: Params): { changes: number; lastInsertRowid: number | bigint } {
    return this.prepare(sql).run(...params);
  }
  /** Transação síncrona; desfaz tudo se a função lançar. */
  private depth = 0;
  tx<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T {
    if (this.depth > 0) return fn(); // transação externa já protege
    this.depth++;
    try {
      return this.txInner(fn);
    } finally {
      this.depth--;
    }
  }
  private txInner<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.statements.clear();
    this.raw.close();
  }
}

// Bancos antigos registraram 015_worker.sql com o nome 014_worker.sql; só reconcilia se o esquema já estiver íntegro.
function hasLegacyWorkerSchema(db: Db): boolean {
  const hasRetractionCol = !!db.get("SELECT 1 FROM pragma_table_info('articles') WHERE name = 'retraction_checked_at'");
  const hasTitleIndex = !!db.get("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_articles_title_lower'");
  const hasReservationsTable = !!db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_budget_reservations'");
  return hasRetractionCol && hasTitleIndex && hasReservationsTable;
}

export function migrate(db: Db): string[] {
  db.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  const applied: string[] = [];
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const installed = db.tx(() => {
      if (db.get('SELECT 1 FROM schema_migrations WHERE name = ?', name)) return false;
      const alreadyAppliedLegacy =
        name === '015_worker.sql'
        && !!db.get("SELECT 1 FROM schema_migrations WHERE name = '014_worker.sql'")
        && hasLegacyWorkerSchema(db);
      if (!alreadyAppliedLegacy) db.raw.exec(sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', name, new Date().toISOString());
      return true;
    });
    if (installed) applied.push(name);
  }
  return applied;
}

export function openDb(path: string, authToken?: string): Db {
  const db = new Db(path, authToken);
  migrate(db);
  return db;
}

export const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
