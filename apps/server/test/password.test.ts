import { describe, expect, it } from 'vitest';
import { H, setup } from './helpers.ts';

const prod = { NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'segredo-de-teste', ADMIN_EMAILS: 'chefe@example.com' };
const cookieOf = (r: { cookies: { name: string; value: string }[] }) => r.cookies.find((c) => c.name === 'jm_session')?.value;

describe('cadastro e entrada com e-mail e senha (sem provedor de e-mail)', () => {
  it('cria conta, recusa e-mail repetido, entra com a senha certa e recusa a errada', async () => {
    const { app, db } = await setup(prod);
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, payload: { email: 'Ana@Example.com', password: 'senha-forte-1' } });
    expect(reg.statusCode).toBe(200);
    const me = await app.inject({ url: '/api/v1/me', cookies: { jm_session: cookieOf(reg)! } });
    expect(me.json()).toMatchObject({ email: 'ana@example.com', isGuest: false, role: 'reader' });
    // senha nunca em texto
    const row = db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'ana@example.com'")!;
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('senha-forte-1');

    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, payload: { email: 'ana@example.com', password: 'outra-senha-2' } });
    expect(again.statusCode).toBe(409);

    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: H, payload: { email: 'ana@example.com', password: 'senha-errada' } });
    expect(wrong.statusCode).toBe(401);
    const ghost = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: H, payload: { email: 'ninguem@example.com', password: 'senha-errada' } });
    expect(ghost.statusCode).toBe(401);
    expect(ghost.json().message).toBe(wrong.json().message); // não revela se a conta existe

    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: H, payload: { email: 'ana@example.com', password: 'senha-forte-1' } });
    expect(ok.statusCode).toBe(200);
    expect(cookieOf(ok)).toBeTruthy();
  });

  it('senha curta é recusada e cadastro com senha nunca dá papel de admin', async () => {
    const { app } = await setup(prod);
    const short = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, payload: { email: 'b@example.com', password: '123' } });
    expect(short.statusCode).toBe(400);
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, payload: { email: 'chefe@example.com', password: 'senha-forte-1' } });
    const me = await app.inject({ url: '/api/v1/me', cookies: { jm_session: cookieOf(reg)! } });
    expect(me.json().role).toBe('reader');
  });

  it('visitante que cria conta mantém o que salvou', async () => {
    const { app, db } = await setup(prod);
    const g = await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H });
    const guestId = (await app.inject({ url: '/api/v1/me', cookies: { jm_session: cookieOf(g)! } })).json().id;
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, cookies: { jm_session: cookieOf(g)! }, payload: { email: 'c@example.com', password: 'senha-forte-1' } });
    expect(reg.statusCode).toBe(200);
    expect(db.get<{ id: string }>("SELECT id FROM users WHERE email = 'c@example.com'")!.id).toBe(guestId);
  });
});
