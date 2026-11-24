import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
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
