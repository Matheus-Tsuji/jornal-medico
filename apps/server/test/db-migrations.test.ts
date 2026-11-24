import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Db, migrate, REPO_ROOT } from '../src/db/index.ts';

const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/server/src/db/migrations');

function seedLegacyWorkerDb(db: Db) {
  db.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    if (name === '016_rate_limits.sql') break;
    db.raw.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    const recordedName = name === '015_worker.sql' ? '014_worker.sql' : name;
    db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', recordedName, '2026-11-24T00:00:00.000Z');
  }
}

it('ignora migrações concluídas por outra inicialização antes da transação', () => {
  const db = new Db(':memory:');
  try {
    const transaction = db.tx.bind(db);
    vi.spyOn(db, 'tx').mockImplementationOnce((apply) => {
      expect(migrate(db).length).toBeGreaterThan(0);
      return transaction(apply);
    });
    expect(migrate(db)).toEqual([]);
  } finally {
    db.close();
  }
});

it('reconcilia 014_worker.sql legada com 015_worker.sql sem falhar e de forma idempotente', () => {
  const db = new Db(':memory:');
  try {
    seedLegacyWorkerDb(db);
    expect(migrate(db)).toEqual(['015_worker.sql', '016_rate_limits.sql']);
    expect(migrate(db)).toEqual([]);
    const names = db.all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name').map((r) => r.name);
    expect(names).toContain('014_worker.sql');
    expect(names).toContain('014_selo_publicacao.sql');
    expect(names).toContain('015_worker.sql');
    expect(names).toContain('016_rate_limits.sql');
  } finally {
    db.close();
  }
});

it('reconciliação legada 014_worker.sql → 015_worker.sql resiste a inicialização concorrente', () => {
  const db = new Db(':memory:');
  try {
    seedLegacyWorkerDb(db);
    const transaction = db.tx.bind(db);
    vi.spyOn(db, 'tx').mockImplementationOnce((apply) => {
      expect(migrate(db)).toEqual(['015_worker.sql', '016_rate_limits.sql']);
      return transaction(apply);
    });
    expect(migrate(db)).toEqual([]);
  } finally {
    db.close();
  }
});

it('não mascara esquema incompleto quando 014_worker.sql está registrada mas falta objeto da 015_worker.sql', () => {
  const db = new Db(':memory:');
  try {
    seedLegacyWorkerDb(db);
    db.raw.exec('DROP TABLE ai_budget_reservations');
    // Coluna retraction_checked_at já existe, mas ai_budget_reservations sumiu: não deve fingir sucesso.
    expect(() => migrate(db)).toThrow(/duplicate column name: retraction_checked_at/i);
  } finally {
    db.close();
  }
});
