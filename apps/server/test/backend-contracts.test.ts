import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { articleListResponse } from '@jm/contracts';
import { buildApp } from '../src/api/app.ts';
import { claim, defer, enqueue } from '../src/modules/jobs.ts';
import { europePmcAdapter } from '../src/sources/europepmc.ts';
import { pubmedAdapter } from '../src/sources/pubmed.ts';
import { scieloAdapter } from '../src/sources/scielo.ts';
import { H, setup, testConfig } from './helpers.ts';

it('expõe os contratos HTTP de cadastro, login, catálogo e processamento manual', async () => {
  const { app } = await setup();
  const response = await app.inject({ url: '/api/v1/openapi.json' });
  expect(response.statusCode).toBe(200);
  const { paths } = response.json();
  for (const route of ['/api/v1/auth/register', '/api/v1/auth/login']) {
    const operation = paths[route].post;
    expect(operation.requestBody.content['application/json'].schema.required).toEqual(expect.arrayContaining(['email', 'password']));
    expect(operation.responses['200'].content['application/json'].schema.required).toEqual(['ok', 'onboarded']);
  }
  expect(paths['/api/v1/articles'].get.parameters).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'topic', in: 'query' }),
    expect.objectContaining({ name: 'limit', in: 'query', schema: expect.objectContaining({ maximum: 50 }) }),
  ]));
  expect(paths['/api/v1/admin/jobs/process'].post.requestBody.required).toBe(false);
  expect(paths['/api/v1/articles'].get.responses['200'].content['application/json'].schema.required)
    .toEqual(['items', 'nextCursor']);
  const articles = await app.inject({ url: '/api/v1/articles' });
  expect(articleListResponse.parse(articles.json()).items.length).toBeGreaterThan(0);
});

it('duas APIs compartilham o limite de autenticação do mesmo banco', async () => {
  const { db, cfg, app } = await setup({
    NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32), PAYMENT_WEBHOOK_SECRET: 'apenas-para-teste',
  });
  const second = await buildApp({ db, cfg });
  const request = { method: 'POST' as const, url: '/api/v1/auth/guest', headers: H };
  try {
    for (let i = 0; i < 10; i++) {
      expect((await (i % 2 ? second : app).inject(request)).statusCode).toBe(200);
    }
    expect((await second.inject(request)).statusCode).toBe(429);
  } finally {
    await second.close();
    await app.close();
  }
});

it('rejeita respostas malformadas com contexto da fonte', async () => {
  const invalid: typeof fetch = async () => Response.json({ unexpected: true });
  const sources = [pubmedAdapter(testConfig(), invalid), europePmcAdapter(invalid), scieloAdapter(invalid)];
  await Promise.all(sources.map((source) =>
    expect(source.search('tema', '2026-11-23', '2026-11-24', 10)).rejects.toThrow(/contrato de resposta inválido/)));
});

it('adiar um job devolve a tentativa e libera a posse até o próximo horário', async () => {
  const { db } = await setup();
  const { id } = enqueue(db, 'compose', 'defer-contract', { date: '2026-11-24' });
  const job = claim(db, 'first')!;
  expect(job.id).toBe(id);
  const started = Date.now();
  expect(defer(db, job, 'aguardando configuração', 60_000)).toBe(true);
  expect(defer(db, job, 'posse vencida', 60_000)).toBe(false);
  expect(db.get('SELECT status, attempts, locked_by FROM jobs WHERE id = ?', id))
    .toEqual({ status: 'retry', attempts: 0, locked_by: null });
  expect(Date.parse(db.get<{ next_run_at: string }>('SELECT next_run_at FROM jobs WHERE id = ?', id)!.next_run_at))
    .toBeGreaterThanOrEqual(started + 60_000);
  expect(claim(db, 'second')).toBeNull();
});

it('na Vercel avisa sobre a vitrine e responde 410 ao endpoint do cron desativado', () => {
  const directory = mkdtempSync(join(tmpdir(), 'indi-vercel-'));
  try {
    const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_AUTH_TOKEN', 'SESSION_SECRET', 'PAYMENT_WEBHOOK_SECRET', 'JM_ROOT']) delete process.env[key];
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      process.env.DATABASE_URL = 'file:./data/unused-test.db';
      const warnings = [];
      console.warn = (line) => warnings.push(line);
      const { default: handler } = await import('./src/api/vercel.ts');
      async function tick() {
        const response = { statusCode: 200, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
        await handler({ url: '/api/v1/cron/tick', headers: {} }, response);
        return response;
      }
      assert.ok(warnings.some((line) => line.includes('Modo vitrine efêmera')));
      const gone = await tick();
      assert.equal(gone.statusCode, 410);
      assert.equal(gone.body.code, 'cron_disabled');
    `], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory },
      encoding: 'utf8',
    });
    expect(result).toBeDefined();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
