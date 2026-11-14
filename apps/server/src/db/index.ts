// Acesso ao SQLite nativo do Node (node:sqlite). Todas as consultas usam parâmetros.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export type Row = Record<string, unknown>;
export type Params = SQLInputValue[];

export class Db {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    const file = path === ':memory:' || isAbsolute(path) ? path : resolve(REPO_ROOT, path);
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  }
  get<T = Row>(sql: string, ...params: Params): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Params): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: Params) {
    return this.raw.prepare(sql).run(...params);
  }
  /** Transação síncrona; desfaz tudo se a função lançar. */
  private depth = 0;
  tx<T>(fn: () => T): T {
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
    this.raw.close();
  }
}

export function migrate(db: Db): string[] {
  db.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  const applied: string[] = [];
  for (const name of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    db.tx(() => {
      db.raw.exec(sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', name, new Date().toISOString());
    });
    applied.push(name);
  }
  return applied;
}

export function openDb(path: string): Db {
  const db = new Db(path);
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
