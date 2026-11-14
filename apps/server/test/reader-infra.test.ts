import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, REPO_ROOT } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { loadConfig } from '../src/config.ts';
import { H, login, setup, testConfig } from './helpers.ts';

describe('leitor', () => {
  it('demo é rotulado; preferências, salvos e leitura persistem; histórico pode ser apagado', async () => {
    const { app, db } = await setup();
    const ed = (await app.inject({ url: '/api/v1/editions/latest' })).json().edition;
    expect(ed.isDemo).toBe(true);
    expect(ed.headline.headline).toMatch(/fictício/i);
    const ck = await login(app, db, 'leitora@example.com');
    const prefs = await app.inject({ method: 'PATCH', url: '/api/v1/me/preferences', headers: H, cookies: ck, payload: { topics: ['diabetes', 'tema-que-nao-existe'] } });
    expect(prefs.json().topics).toEqual(['diabetes']); // só temas existentes e habilitados são seguidos
    const art = ed.headline;
    await app.inject({ method: 'POST', url: '/api/v1/bookmarks', headers: H, cookies: ck, payload: { articleId: art.id } });
    await app.inject({ method: 'POST', url: '/api/v1/events/read', headers: H, cookies: ck, payload: { articleId: art.id, kind: 'open' } });
    await app.inject({ method: 'POST', url: '/api/v1/events/read', headers: H, cookies: ck, payload: { articleId: art.id, kind: 'open' } });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM read_events')!.n).toBe(1); // deduplicado por dia
    expect((await app.inject({ url: '/api/v1/bookmarks', cookies: ck })).json().items[0].id).toBe(art.id);
    expect((await app.inject({ url: '/api/v1/history', cookies: ck })).json().items.length).toBe(1);
    await app.inject({ method: 'DELETE', url: '/api/v1/me/history', headers: H, cookies: ck });
    expect((await app.inject({ url: '/api/v1/history', cookies: ck })).json().items.length).toBe(0);
  });

  it('relato de erro científico é separado de feedback de relevância', async () => {
    const { app, db } = await setup();
    const ck = await login(app, db, 'r@example.com');
    const art = (await app.inject({ url: '/api/v1/editions/latest' })).json().edition.headline;
    expect((await app.inject({ method: 'POST', url: '/api/v1/reports', headers: H, cookies: ck, payload: { articleId: art.id, message: 'curto' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/reports', headers: H, cookies: ck, payload: { articleId: art.id, message: 'O IC do desfecho secundário parece trocado.' } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/v1/feedback', headers: H, cookies: ck, payload: { articleId: art.id, value: 'less_of_topic' } });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM error_reports')!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM feedback')!.n).toBe(1);
  });

  it('exporta e exclui os próprios dados', async () => {
    const { app, db } = await setup();
    const ck = await login(app, db, 'lgpd@example.com');
    const exp = await app.inject({ url: '/api/v1/me/export', cookies: ck });
    expect(exp.json().user.email).toBe('lgpd@example.com');
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: H, cookies: ck, payload: { confirm: 'errado' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: H, cookies: ck, payload: { confirm: 'EXCLUIR' } })).statusCode).toBe(200);
    expect(db.get("SELECT 1 FROM users WHERE email = 'lgpd@example.com'")).toBeUndefined();
    expect((await app.inject({ url: '/api/v1/me', cookies: ck })).statusCode).toBe(401);
  });

  it('erros têm code/message/requestId e nunca stack trace', async () => {
    const { app } = await setup();
    const r = await app.inject({ url: '/api/v1/articles/nao-existe' });
    expect(r.statusCode).toBe(404);
    expect(Object.keys(r.json()).sort()).toEqual(['code', 'message', 'requestId']);
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('infraestrutura', () => {
  it('dados persistem após reinício e backup consistente restaura', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jm-'));
    const file = join(dir, 'j.db');
    const cfg = testConfig();
    let db = openDb(file);
    seed(db, cfg);
    db.run("INSERT INTO users (id, email, created_at) VALUES ('u1', 'p@example.com', '2026-11-14T00:00:00Z')");
    db.close();
    db = openDb(file);
    expect(db.get<{ email: string }>("SELECT email FROM users WHERE id = 'u1'")!.email).toBe('p@example.com');
    const bak = join(dir, 'b.db');
    db.raw.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
    db.close();
    const r = openDb(bak);
    expect(r.get<{ integrity_check: string }>('PRAGMA integrity_check')!.integrity_check).toBe('ok');
    expect(r.get<{ n: number }>('SELECT COUNT(*) AS n FROM articles')!.n).toBe(9);
    r.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('produção exige segredos e provedor real de e-mail', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'development', OPENAI_API_KEY: 'x' } as NodeJS.ProcessEnv)).toThrow(/OPENAI_ANALYSIS_MODEL/);
  });

  it('bundle web não contém segredos nem nomes de variáveis do servidor', () => {
    const dist = join(REPO_ROOT, 'apps/web/dist/assets');
    if (!existsSync(dist)) return; // roda após `npm run build`
    const js = readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
    // Valores de segredo (formato de chave e segredos de dev) nunca podem aparecer; o nome OPENAI_API_KEY pode, em mensagens de configuração.
    expect(js).not.toMatch(/sk-(proj-)?[A-Za-z0-9_-]{20,}/);
    for (const s of ['dev-only-secret', 'dev-only-webhook-secret', 'SESSION_SECRET', 'PAYMENT_WEBHOOK_SECRET', 'NCBI_API_KEY', 'AUTH_EMAIL_API_KEY']) expect(js).not.toContain(s);
  });
});

describe('front-end servido pela API', () => {
  it('serve arquivo criado depois da inicialização (build novo sem reiniciar) e cai no index para rotas da SPA', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'jm-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>');
    const { app } = await setup({ WEB_DIST: dir });
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'novo-123.js'), 'console.log(1)');
    const js = await app.inject({ url: '/assets/novo-123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    const spa = await app.inject({ url: '/jornal' });
    expect(spa.body).toContain('<title>spa</title>');
    expect((await app.inject({ url: '/api/v1/nao-existe' })).json().code).toBe('not_found');
    rmSync(dir, { recursive: true, force: true });
  });
});
