import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/index.ts';
import { loginWithPassword, registerWithPassword } from '../src/modules/auth.ts';
import { testConfig } from './helpers.ts';

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
