import { describe, expect, it } from 'vitest';
import { H, login, setup } from './helpers.ts';

async function guest(app: Awaited<ReturnType<typeof setup>>['app']) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H });
  expect(r.statusCode).toBe(200);
  return { jm_session: r.cookies.find((c) => c.name === 'jm_session')!.value };
}
const codeFor = (db: Awaited<ReturnType<typeof setup>>['db'], email: string) =>
  db.get<{ body: string }>('SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1', email)!.body.match(/\d{6}/)![0];

describe('produção sem provedor de e-mail', () => {
  it('sobe só com visitante: pedido de código recusado, nada na caixa postal, visitante entra', async () => {
    const prod = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'segredo-de-teste' };
    const { app, db } = await setup(prod);
    expect((await app.inject({ url: '/api/v1/config' })).json()).toMatchObject({ emailLogin: false, devOutbox: false });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'admin@example.com' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('email_unavailable');
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_challenges')!.n).toBe(0);
    expect((await app.inject({ url: '/api/v1/dev/outbox' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H })).statusCode).toBe(200);
  });
});

describe('vitrine (uma cópia do banco por instância)', () => {
  it('sessão de visitante criada numa instância vale em outra; assinatura falsa não', async () => {
    const prod = { NODE_ENV: 'production', SESSION_SECRET: 'v'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'segredo-de-teste' };
    const a = await setup(prod);
    const b = await setup(prod);
    a.cfg.ephemeral = true;
    b.cfg.ephemeral = true;
    const r = await a.app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H });
    const token = r.cookies.find((c) => c.name === 'jm_session')!.value;
    expect(token.startsWith('g1.')).toBe(true);
    const me = await b.app.inject({ url: '/api/v1/me', cookies: { jm_session: token } });
    expect(me.statusCode).toBe(200);
    expect(me.json().isGuest).toBe(true);
    const forjado = token.replace(/\.[0-9a-f]+$/, '.' + '0'.repeat(64));
    expect((await b.app.inject({ url: '/api/v1/me', cookies: { jm_session: forjado } })).statusCode).toBe(401);
  });
});

describe('visitante (sem e-mail)', () => {
  it('entra sem e-mail, personaliza e salva; não pode assinar', async () => {
    const { app } = await setup();
    const ck = await guest(app);
    const me = (await app.inject({ url: '/api/v1/me', cookies: ck })).json();
    expect(me.isGuest).toBe(true);
    expect(me.email).toBe('');
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/me/preferences', headers: H, cookies: ck, payload: { topics: ['diabetes'] } })).json().topics).toEqual(['diabetes']);
    const plan = (await app.inject({ url: '/api/v1/billing/plans' })).json().items[0];
    const co = await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: ck, payload: { planId: plan.id } });
    expect(co.statusCode).toBe(403);
    expect(co.json().code).toBe('guest_needs_email');
  });

  it('ao informar e-mail novo, a mesma conta é mantida com salvos e interesses', async () => {
    const { app, db } = await setup();
    const ck = await guest(app);
    const guestId = (await app.inject({ url: '/api/v1/me', cookies: ck })).json().id;
    const art = (await app.inject({ url: '/api/v1/editions/latest' })).json().edition.headline;
    await app.inject({ method: 'POST', url: '/api/v1/bookmarks', headers: H, cookies: ck, payload: { articleId: art.id } });
    await app.inject({ method: 'PATCH', url: '/api/v1/me/preferences', headers: H, cookies: ck, payload: { topics: ['diabetes'] } });
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, cookies: ck, payload: { email: 'novo@example.com' } });
    const v = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, cookies: ck, payload: { email: 'novo@example.com', code: codeFor(db, 'novo@example.com') } });
    const ck2 = { jm_session: v.cookies.find((c) => c.name === 'jm_session')!.value };
    const me = (await app.inject({ url: '/api/v1/me', cookies: ck2 })).json();
    expect(me.id).toBe(guestId);
    expect(me.isGuest).toBe(false);
    expect(me.email).toBe('novo@example.com');
    expect(me.preferences.topics).toEqual(['diabetes']);
    expect((await app.inject({ url: '/api/v1/bookmarks', cookies: ck2 })).json().items[0].id).toBe(art.id);
    expect((await app.inject({ url: '/api/v1/me', cookies: ck })).statusCode).toBe(401); // sessão antiga rotacionada
  });

  it('e-mail que já tem conta: salvos do visitante são levados e o visitante some', async () => {
    const { app, db } = await setup();
    await login(app, db, 'antiga@example.com');
    const ck = await guest(app);
    const art = (await app.inject({ url: '/api/v1/editions/latest' })).json().edition.headline;
    await app.inject({ method: 'POST', url: '/api/v1/bookmarks', headers: H, cookies: ck, payload: { articleId: art.id } });
    db.run("DELETE FROM auth_challenges WHERE email = 'antiga@example.com'");
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, cookies: ck, payload: { email: 'antiga@example.com' } });
    const v = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, cookies: ck, payload: { email: 'antiga@example.com', code: codeFor(db, 'antiga@example.com') } });
    const ck2 = { jm_session: v.cookies.find((c) => c.name === 'jm_session')!.value };
    expect((await app.inject({ url: '/api/v1/bookmarks', cookies: ck2 })).json().items.length).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_guest = 1')!.n).toBe(0);
  });
});
