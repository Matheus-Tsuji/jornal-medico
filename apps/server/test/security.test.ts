// Fase 1 da auditoria de backend: autenticação, ambiente, segredos, billing e bordas.
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { emailSchema } from '@jm/contracts';
import { ensureSecrets, loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import type { Db } from '../src/db/index.ts';
import { httpsUrl, id, nowIso } from '../src/lib/util.ts';
import { STAFF_IDLE_DAYS, purgeAuthData } from '../src/modules/auth.ts';
import { signPayload } from '../src/modules/billing.ts';
import { SECURITY_HEADERS, vercelConfig } from '../../../scripts/vercel-config.mjs';
import { H, login, setup } from './helpers.ts';

const cookieOf = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === 'jm_session')?.value;
const reg = (app: FastifyInstance, email: string, password = 'senha-forte-1', cookies?: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, cookies, payload: { email, password, displayName: 'Fulano' } });
const pwLogin = (app: FastifyInstance, email: string, password = 'senha-forte-1') =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: H, payload: { email, password } });
const meStatus = async (app: FastifyInstance, c: string) => (await app.inject({ url: '/api/v1/me', cookies: { jm_session: c } })).statusCode;
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('SEG-01: cadastro por senha de e-mail alheio não sobrevive à comprovação do dono', () => {
  it('OTP do dono grava verified_at, apaga a senha do atacante, derruba a sessão dele e só então dá admin', async () => {
    const { app, db } = await setup(); // ADMIN_EMAILS=admin@example.com
    const attacker = await reg(app, 'admin@example.com');
    expect(attacker.statusCode).toBe(200);
    const attackerCookie = cookieOf(attacker)!;
    expect(await meStatus(app, attackerCookie)).toBe(200);

    const owner = await login(app, db, 'admin@example.com');
    const row = db.get<{ verified_at: string | null; password_hash: string | null; role: string }>("SELECT verified_at, password_hash, role FROM users WHERE email = 'admin@example.com'")!;
    expect(row.verified_at).toBeTruthy();
    expect(row.password_hash).toBeNull();
    expect(row.role).toBe('admin');
    expect(await meStatus(app, attackerCookie)).toBe(401);
    expect((await pwLogin(app, 'admin@example.com')).statusCode).toBe(401);
    expect(await meStatus(app, owner.jm_session!)).toBe(200);
  });

  it('editor/admin sem verified_at não entra por senha', async () => {
    const { app, db } = await setup();
    await reg(app, 'ed@example.com');
    db.run("UPDATE users SET role = 'editor' WHERE email = 'ed@example.com'");
    expect((await pwLogin(app, 'ed@example.com')).statusCode).toBe(401);
  });
});

describe('SEG-04/GIT-03/SEG-06: configuração de ambiente', () => {
  it('fora de produção só escuta em loopback', () => {
    expect(() => loadConfig(env({ NODE_ENV: 'development', HOST: '0.0.0.0' }))).toThrow(/loopback/);
    expect(() => loadConfig(env({ NODE_ENV: 'development', HOST: '127.0.0.1' }))).not.toThrow();
  });
  it('produção com banco remoto exige só SESSION_SECRET; o segredo do webhook nunca vai para o banco', async () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'libsql://exemplo.turso.io' };
    expect(() => loadConfig(env(base))).toThrow(/SESSION_SECRET/);
    const cfg = loadConfig(env({ ...base, SESSION_SECRET: 's'.repeat(40) }));
    const db = openDb(':memory:');
    ensureSecrets(db, cfg);
    expect(cfg.PAYMENT_WEBHOOK_SECRET).toBeUndefined();
    expect(db.get('SELECT 1 FROM app_secrets WHERE name = ?', 'payment_webhook_secret')).toBeUndefined();
  });
  it('paywall com provedor sandbox é recusado em produção', () => {
    expect(() => loadConfig(env({ NODE_ENV: 'production', PAYWALL_ENABLED: 'true' }))).toThrow(/sandbox/);
  });
  it('caixa postal de dev só com flag explícita e fora de produção', async () => {
    expect((await (await setup()).app.inject({ url: '/api/v1/dev/outbox' })).statusCode).toBe(404);
    expect((await (await setup({ DEV_OUTBOX: 'true' })).app.inject({ url: '/api/v1/dev/outbox' })).statusCode).toBe(200);
    expect((await (await setup({ NODE_ENV: 'production', DEV_OUTBOX: 'true' })).app.inject({ url: '/api/v1/dev/outbox' })).statusCode).toBe(404);
  });
});

describe('SEG-03/SEG-14/SEG-17: força bruta', () => {
  it('bloqueia senha por e-mail após 10 falhas, mesmo com a senha certa', async () => {
    const { app } = await setup();
    await reg(app, 'alvo@example.com');
    for (let i = 0; i < 10; i++) expect((await pwLogin(app, 'alvo@example.com', 'errada-123')).statusCode).toBe(401);
    expect((await pwLogin(app, 'alvo@example.com')).statusCode).toBe(429);
  });
  it('OTP recusa a partir da 6ª tentativa, mesmo com o código certo', async () => {
    const { app, db } = await setup();
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'otp@example.com' } });
    const code = db.get<{ body: string }>("SELECT body FROM dev_outbox WHERE to_email = 'otp@example.com'")!.body.match(/\d{6}/)![0];
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'otp@example.com', code: wrong } });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'otp@example.com', code } });
    expect(r.statusCode).toBe(400);
  });
  it('teto diário de códigos por e-mail', async () => {
    const { app, db } = await setup();
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    for (let i = 0; i < 20; i++) db.run('INSERT INTO auth_challenges (id, email, code_hash, expires_at, ip, created_at) VALUES (?,?,?,?,?,?)', id(), 'dia@example.com', 'x', old, '1.1.1.1', old);
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'dia@example.com' } });
    expect(r.statusCode).toBe(429);
  });
});

describe('SEG-06/COD-01: assinatura', () => {
  const hook = (app: FastifyInstance, secret: string, body: unknown, provider = 'sandbox') => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return app.inject({ method: 'POST', url: `/api/v1/billing/webhook/${provider}`, headers: { 'content-type': 'application/json', 'x-webhook-signature': signPayload(secret, raw) }, payload: raw });
  };
  const plan = (db: Db) => db.get<{ id: string }>('SELECT id FROM plans WHERE active = 1 LIMIT 1')!.id;

  it('sandbox/complete não existe em produção', async () => {
    const { app } = await setup({ NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'w'.repeat(32) });
    const g = await reg(app, 'p@example.com');
    const r = await app.inject({ method: 'POST', url: '/api/v1/billing/sandbox/complete', headers: H, cookies: { jm_session: cookieOf(g)! }, payload: { subscription: 'x', outcome: 'approved' } });
    expect(r.statusCode).toBe(404);
  });

  it('checkout antigo (cancelado) não pode ser concluído; nunca duas ativas', async () => {
    const { app, db } = await setup();
    const c = await login(app, db, 'assina@example.com');
    const co = (await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: c, payload: { planId: plan(db) } })).json();
    const co2 = (await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: c, payload: { planId: plan(db) } })).json();
    const old = await app.inject({ method: 'POST', url: '/api/v1/billing/sandbox/complete', headers: H, cookies: c, payload: { subscription: co.externalId, outcome: 'approved' } });
    expect(old.statusCode).toBe(409);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/billing/sandbox/complete', headers: H, cookies: c, payload: { subscription: co2.externalId, outcome: 'approved' } });
    expect(ok.statusCode).toBe(200);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE u.email = 'assina@example.com' AND s.status = 'active'")!.n).toBe(1);
  });

  it('webhook valida o payload', async () => {
    const { app, db, cfg } = await setup();
    const s = cfg.PAYMENT_WEBHOOK_SECRET!;
    expect((await hook(app, s, 'não é json')).statusCode).toBe(400);
    expect((await hook(app, s, { id: 'e1', type: 'constructor', data: { subscriptionId: 'x' } })).statusCode).toBe(400);
    expect((await hook(app, s, { id: 'e2', type: 'qualquer.coisa', data: { subscriptionId: 'x' } })).statusCode).toBe(400);
    expect((await hook(app, s, { id: 'e3', type: 'subscription.renewed', data: { subscriptionId: 'x', currentPeriodEnd: 'amanhã' } })).statusCode).toBe(400);
    expect((await hook(app, s, { id: 'e4', type: 'subscription.renewed', data: { subscriptionId: 'x' } }, 'stripe')).statusCode).toBe(404);
    expect((await hook(app, s, { id: 'e5', type: 'subscription.renewed', data: { subscriptionId: 'nao-existe' } })).statusCode).toBe(404);
    void db;
  });

  it('assinatura cancelada ao fim do período libera nova contratação após vencer', async () => {
    const { app, db } = await setup();
    const c = await login(app, db, 'volta@example.com');
    const co = (await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: c, payload: { planId: plan(db) } })).json();
    await app.inject({ method: 'POST', url: '/api/v1/billing/sandbox/complete', headers: H, cookies: c, payload: { subscription: co.externalId, outcome: 'approved' } });
    await app.inject({ method: 'POST', url: '/api/v1/billing/cancel', headers: H, cookies: c });
    expect((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: c, payload: { planId: plan(db) } })).statusCode).toBe(409);
    db.run("UPDATE subscriptions SET current_period_end = ? WHERE external_id = ?", new Date(Date.now() - 86_400_000).toISOString(), co.externalId);
    expect((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: c, payload: { planId: plan(db) } })).statusCode).toBe(200);
  });
});

describe('SEG-05/GER-15: cabeçalhos do site estático e /ready na função', () => {
  it('rotas estáticas e fallback levam os cabeçalhos; /ready vai para a API', () => {
    const cfg = vercelConfig();
    const fallback = cfg.routes.at(-1)!;
    expect(fallback.dest).toBe('/index.html');
    for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security']) {
      expect(fallback.headers).toHaveProperty(h);
    }
    expect(SECURITY_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(cfg.routes.some((r) => r.headers === SECURITY_HEADERS && r.continue)).toBe(true);
    expect(new RegExp(cfg.routes.find((r) => r.dest === '/api')!.src!).test('/ready')).toBe(true);
    expect(cfg.crons).toEqual([]); // ciclo diário na Vercel desativado
  });
});

describe('SEG-08/SEG-09: bordas', () => {
  it('domínio de visitante é recusado no cadastro', async () => {
    expect(emailSchema.safeParse('visitante-abc@visitante.invalid').success).toBe(false);
    const { app } = await setup();
    expect((await reg(app, 'visitante-abc@visitante.invalid')).statusCode).toBe(400);
  });
  it('só URLs https passam', () => {
    expect(httpsUrl('javascript:alert(1)')).toBeNull();
    expect(httpsUrl('http://exemplo.com')).toBeNull();
    expect(httpsUrl('lixo')).toBeNull();
    expect(httpsUrl('https://doi.org/10.99999/demo')).toBe('https://doi.org/10.99999/demo');
  });
});

describe('SEG-11: papel e inatividade da equipe', () => {
  it('admin rebaixado continua rebaixado após novo login por código', async () => {
    const { app, db } = await setup();
    await login(app, db, 'admin@example.com');
    db.run("UPDATE users SET role = 'reader' WHERE email = 'admin@example.com'");
    await login(app, db, 'admin@example.com');
    expect(db.get<{ role: string }>("SELECT role FROM users WHERE email = 'admin@example.com'")!.role).toBe('reader');
  });
  it('sessão de editor parada além do limite cai', async () => {
    const { app, db } = await setup();
    const c = await login(app, db, 'admin@example.com');
    db.run('UPDATE sessions SET last_seen_at = ?', new Date(Date.now() - (STAFF_IDLE_DAYS + 1) * 86_400_000).toISOString());
    expect(await meStatus(app, c.jm_session!)).toBe(401);
  });
});

describe('SEG-12/SEG-18/FUN-05: dados do leitor', () => {
  it('exportação inclui nome e verificação; limpeza remove só o vencido', async () => {
    const { app, db } = await setup();
    const c = await login(app, db, 'lgpd@example.com');
    const ex = (await app.inject({ url: '/api/v1/me/export', cookies: c })).json();
    expect(ex.user).toHaveProperty('display_name');
    expect(ex.user.verified_at).toBeTruthy();

    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    db.run('INSERT INTO auth_challenges (id, email, code_hash, expires_at, ip, created_at) VALUES (?,?,?,?,?,?)', 'velho', 'x@example.com', 'x', old, '1.1.1.1', old);
    purgeAuthData(db);
    expect(db.get("SELECT 1 FROM auth_challenges WHERE id = 'velho'")).toBeUndefined();
    expect(await meStatus(app, c.jm_session!)).toBe(200); // sessão ativa fica
  });

  it('relato exige conta e tem teto diário; feedback de artigo inexistente é 404', async () => {
    const { app, db } = await setup();
    const art = db.get<{ id: string }>('SELECT id FROM articles LIMIT 1')!.id;
    const g = cookieOf(await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H }))!;
    const guestRep = await app.inject({ method: 'POST', url: '/api/v1/reports', headers: H, cookies: { jm_session: g }, payload: { articleId: art, message: 'Número errado no resumo.' } });
    expect(guestRep.statusCode).toBe(403);
    const c = await login(app, db, 'relata@example.com');
    const uid = db.get<{ id: string }>("SELECT id FROM users WHERE email = 'relata@example.com'")!.id;
    for (let i = 0; i < 10; i++) db.run('INSERT INTO error_reports (id, user_id, article_id, message, created_at) VALUES (?,?,?,?,?)', id(), uid, art, 'x', nowIso());
    const capped = await app.inject({ method: 'POST', url: '/api/v1/reports', headers: H, cookies: c, payload: { articleId: art, message: 'Número errado no resumo.' } });
    expect(capped.statusCode).toBe(429);
    const fb = await app.inject({ method: 'POST', url: '/api/v1/feedback', headers: H, cookies: c, payload: { articleId: '00000000-0000-0000-0000-000000000000', value: 'relevant' } });
    expect(fb.statusCode).toBe(404);
  });

  it('visitante que entra em conta existente leva o histórico de leitura', async () => {
    const { app, db } = await setup();
    await login(app, db, 'hist@example.com');
    const uid = db.get<{ id: string }>("SELECT id FROM users WHERE email = 'hist@example.com'")!.id;
    const [a1, a2] = db.all<{ id: string }>('SELECT id FROM articles LIMIT 2').map((r) => r.id) as [string, string];
    const g = cookieOf(await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H }))!;
    const gid = (await app.inject({ url: '/api/v1/me', cookies: { jm_session: g } })).json().id;
    const day = '2026-11-20';
    db.run('INSERT INTO read_events (id, user_id, article_id, kind, day, created_at) VALUES (?,?,?,?,?,?)', id(), uid, a1, 'open', day, nowIso());
    db.run('INSERT INTO read_events (id, user_id, article_id, kind, day, created_at) VALUES (?,?,?,?,?,?)', id(), gid, a1, 'open', day, nowIso()); // conflitante
    db.run('INSERT INTO read_events (id, user_id, article_id, kind, day, created_at) VALUES (?,?,?,?,?,?)', id(), gid, a2, 'open', day, nowIso()); // inédito
    db.run("DELETE FROM auth_challenges WHERE email = 'hist@example.com'");
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'hist@example.com' } });
    const code = db.get<{ body: string }>("SELECT body FROM dev_outbox WHERE to_email = 'hist@example.com' ORDER BY created_at DESC LIMIT 1")!.body.match(/\d{6}/)![0];
    const v = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, cookies: { jm_session: g }, payload: { email: 'hist@example.com', code } });
    expect(v.statusCode).toBe(200);
    expect(db.all('SELECT article_id FROM read_events WHERE user_id = ?', uid).length).toBe(2);
  });
});
