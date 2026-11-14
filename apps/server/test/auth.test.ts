import { describe, expect, it } from 'vitest';
import { H, login, setup } from './helpers.ts';
import { verifyCode } from '../src/modules/auth.ts';

const lastCode = (db: Awaited<ReturnType<typeof setup>>['db'], email: string) =>
  db.get<{ body: string }>('SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1', email)!.body.match(/\d{6}/)![0];

describe('auth sem senha', () => {
  it('não revela se o e-mail existe (mesma resposta)', async () => {
    const { app, db } = await setup();
    await login(app, db, 'existe@example.com');
    const a = await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'novo@example.com' } });
    db.run("DELETE FROM auth_challenges WHERE email = 'existe@example.com'");
    const b = await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'existe@example.com' } });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
  });

  it('nunca guarda o código em claro', async () => {
    const { app, db } = await setup();
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'x@example.com' } });
    const code = lastCode(db, 'x@example.com');
    const row = db.get<{ code_hash: string }>('SELECT code_hash FROM auth_challenges WHERE email = ?', 'x@example.com')!;
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejeita código inválido, expirado e reutilizado', async () => {
    const { app, db, cfg } = await setup();
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'y@example.com' } });
    const code = lastCode(db, 'y@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'y@example.com', code: wrong } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('invalid_code');
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'y@example.com', code } });
    expect(ok.statusCode).toBe(200);
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'y@example.com', code } });
    expect(reuse.statusCode).toBe(400);
    // expirado
    db.run('DELETE FROM auth_challenges');
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'z@example.com' } });
    const c2 = lastCode(db, 'z@example.com');
    db.run("UPDATE auth_challenges SET expires_at = '2000-01-01T00:00:00Z'");
    expect(() => verifyCode(db, cfg, 'z@example.com', c2)).toThrow(/inválido ou expirado/);
  });

  it('bloqueia o desafio após 5 tentativas erradas', async () => {
    const { app, db } = await setup();
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'w@example.com' } });
    const code = lastCode(db, 'w@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'w@example.com', code: wrong } });
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'w@example.com', code } });
    expect(r.statusCode).toBe(400);
  });

  it('aplica limite de reenvio', async () => {
    const { app } = await setup();
    const send = () => app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'rl@example.com' } });
    expect((await send()).statusCode).toBe(200);
    const second = await send();
    expect(second.statusCode).toBe(429);
  });

  it('sessão revogada deixa de valer; logout-all revoga todas', async () => {
    const { app, db } = await setup();
    const ck = await login(app, db, 'sess@example.com');
    expect((await app.inject({ url: '/api/v1/me', cookies: ck })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: H, cookies: ck });
    expect((await app.inject({ url: '/api/v1/me', cookies: ck })).statusCode).toBe(401);
    const a = await login(app, db, 'sess@example.com');
    const b = await login(app, db, 'sess@example.com');
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: H, cookies: a });
    expect((await app.inject({ url: '/api/v1/me', cookies: b })).statusCode).toBe(401);
  });

  it('papel não autorizado não acessa admin; CSRF bloqueia mutação sem cabeçalho', async () => {
    const { app, db } = await setup();
    const reader = await login(app, db, 'leitor@example.com');
    expect((await app.inject({ url: '/api/v1/admin/reviews', cookies: reader })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/admin/reviews' })).statusCode).toBe(401);
    const admin = await login(app, db, 'admin@example.com');
    expect((await app.inject({ url: '/api/v1/admin/reviews', cookies: admin })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/me', cookies: reader, payload: { onboarded: true } })).statusCode).toBe(403);
  });

  it('cookie de sessão é HttpOnly e SameSite', async () => {
    const { app, db } = await setup();
    await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email: 'c@example.com' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email: 'c@example.com', code: lastCode(db, 'c@example.com') } });
    const c = res.cookies.find((x) => x.name === 'jm_session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
  });
});
