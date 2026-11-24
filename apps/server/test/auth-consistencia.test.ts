import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/index.ts';
import { createGuest, loginWithPassword, registerWithPassword, userFromToken } from '../src/modules/auth.ts';
import { H, setup, testConfig } from './helpers.ts';

describe('consistência do cadastro e login por senha', () => {
  const cfg = testConfig();
  const email = 'leitor@example.com';
  const password = 'senha-de-teste';
  let db: Db;

  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { db.close(); });

  it('cadastros simultâneos para o mesmo e-mail emitem uma única sessão', async () => {
    const results = await Promise.allSettled([
      registerWithPassword(db, cfg, email, password),
      registerWithPassword(db, cfg, email, password),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'email_taken' } });
    expect(db.get('SELECT COUNT(*) AS n FROM sessions')).toEqual({ n: 1 });
  });

  it('respeita o limite de tentativas simultâneas para o mesmo e-mail', async () => {
    await registerWithPassword(db, cfg, email, password);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
      loginWithPassword(db, cfg, email, 'senha-incorreta')));
    const errors = results.map((r) => r.status === 'rejected' ? r.reason.status : 200);
    expect(errors.filter((status) => status === 401)).toHaveLength(10);
    expect(errors.filter((status) => status === 429)).toHaveLength(2);
  });

  it('revoga todas as sessões de visitante antes de converter a conta', async () => {
    const guest = createGuest(db, cfg);
    const { token } = await registerWithPassword(db, cfg, email, password, guest.userId);
    expect(userFromToken(db, guest.token)).toBeNull();
    expect(userFromToken(db, token)).toMatchObject({ id: guest.userId, isGuest: false });
  });

  it('a vitrine não recria sessão antiga de uma conta convertida após limpeza', async () => {
    const { cfg, db } = await setup();
    cfg.ephemeral = true;
    const guest = createGuest(db, cfg);
    await registerWithPassword(db, cfg, email, password, guest.userId);
    db.run('DELETE FROM sessions WHERE revoked_at IS NOT NULL');
    expect(userFromToken(db, guest.token, cfg)).toBeNull();
  });

  it('exige 12 caracteres no cadastro e mantém o login com senha antiga', async () => {
    const { app, cfg, db } = await setup();
    const oldPassword = 'senha-v1';
    // Representa uma conta já criada sob a política anterior de oito caracteres.
    await registerWithPassword(db, cfg, email, oldPassword);
    const register = await app.inject({
      method: 'POST', url: '/api/v1/auth/register', headers: H,
      payload: { email: 'novo@example.com', password: oldPassword, displayName: 'Leitora' },
    });
    expect(register.statusCode).toBe(400);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: H, payload: { email, password: oldPassword },
    });
    expect(login.statusCode).toBe(200);
  });

  it.each([
    ['a credencial é revogada', 'password_hash = NULL'],
    ['o papel passa a exigir verificação de e-mail', "role = 'editor'"],
  ])('não emite sessão se %s durante o cálculo da senha', async (_case, update) => {
    const { userId } = await registerWithPassword(db, cfg, email, password);
    const login = loginWithPassword(db, cfg, email, password);
    db.run(`UPDATE users SET ${update} WHERE id = ?`, userId);
    await expect(login).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', userId)).toEqual({ n: 1 });
  });
});
