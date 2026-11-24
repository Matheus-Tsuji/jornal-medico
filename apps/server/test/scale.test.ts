import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { editionDto } from '../src/modules/content.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { H, login, setup } from './helpers.ts';

it('compartilha a janela de limites e reaplica migrações com segurança em outra conexão', () => {
  const directory = mkdtempSync(join(tmpdir(), 'indi-scale-'));
  try {
    // No Windows, o driver nativo pode reter o arquivo até o fim do processo.
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { migrate, openDb } from './src/db/index.ts';
      import { takeSlot } from './src/lib/rate-limits.ts';
      const a = openDb(process.argv[1]);
      const b = openDb(process.argv[1]);
      assert.deepEqual(migrate(b), []);
      assert.ok(takeSlot(a, 'auth:test', 2, 100, 0));
      assert.ok(takeSlot(b, 'auth:test', 2, 100, 1));
      assert.ok(!takeSlot(a, 'auth:test', 2, 100, 99));
      assert.ok(takeSlot(b, 'auth:test', 2, 100, 100));
      assert.ok(takeSlot(a, 'source:pubmed', 1, 500, 0));
      assert.ok(!takeSlot(b, 'source:pubmed', 1, 500, 499));
      assert.ok(takeSlot(b, 'source:pubmed', 1, 500, 500));
      b.close();
      a.close();
    `, join(directory, 'test.db')], { cwd: join(import.meta.dirname, '..') });
  } finally {
    rmSync(directory, { recursive: true });
  }
});

it('aplica as mesmas migrações durante duas inicializações simultâneas', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'indi-migrations-'));
  try {
    const start = promisify(execFile);
    const args = ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { openDb } from './src/db/index.ts';
      const db = openDb(process.argv[1]);
      assert.equal(db.get("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = '016_rate_limits.sql'").n, 1);
      db.close();
    `, join(directory, 'test.db')];
    const options = { cwd: join(import.meta.dirname, '..') };
    const workers = await Promise.allSettled([start(process.execPath, args, options), start(process.execPath, args, options)]);
    for (const worker of workers) {
      if (worker.status === 'rejected') throw worker.reason;
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

it('carrega os tópicos das seções com uma única consulta', async () => {
  const { db } = await setup();
  const edition = db.get("SELECT * FROM editions WHERE is_demo = 1 ORDER BY edition_date DESC LIMIT 1")!;
  const sections = db.all<{ section_topic_id: string }>("SELECT DISTINCT section_topic_id FROM edition_items WHERE edition_id = ? AND slot = 'section'", edition.id as string);
  expect(sections.length).toBeGreaterThan(1);
  const all = vi.spyOn(db, 'all');
  const get = vi.spyOn(db, 'get');
  const result = editionDto(db, edition);
  expect(result.sections).toHaveLength(sections.length);
  expect(all.mock.calls.filter(([sql]) => sql.includes('FROM topics WHERE id IN'))).toHaveLength(1);
  expect(get.mock.calls.some(([sql]) => sql.includes('FROM topics WHERE id ='))).toBe(false);
});

it('limita o processamento manual sem rejeitar o tamanho pedido pelo painel', async () => {
  const { app, db } = await setup();
  const cookies = await login(app, db, 'admin@example.com');
  for (let i = 0; i < 5; i++) {
    db.run("INSERT INTO jobs (id,type,idempotency_key,payload,status,next_run_at,created_at,updated_at) VALUES (?, 'compose', ?, '{}', 'queued', '2020-01-01', '2020-01-01', '2020-01-01')", `scale-${i}`, `scale-${i}`);
  }
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/jobs/process', cookies, headers: H, payload: { max: 5 } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ processed: 3 });
  expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE id LIKE 'scale-%' AND status = 'queued'")?.n).toBe(2);
});
