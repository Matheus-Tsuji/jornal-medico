// A1/A2 da auditoria: promoção de conta não verificada e rascunho velho de edição.
import { describe, expect, it } from 'vitest';
import { H, login, setup } from './helpers.ts';

describe('A1: equipe só com e-mail comprovado', () => {
  it('promover conta cadastrada só por senha é 409 e a sessão dela não ganha papel', async () => {
    const { app, db } = await setup();
    const admin = await login(app, db, 'admin@example.com');
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: H, payload: { email: 'colega@example.com', password: 'senha-forte-1', displayName: 'Colega' } });
    const sess = r.cookies.find((c) => c.name === 'jm_session')!.value;
    const uid = db.get<{ id: string }>("SELECT id FROM users WHERE email = 'colega@example.com'")!.id;
    const p = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${uid}`, headers: H, cookies: admin, payload: { role: 'editor' } });
    expect(p.statusCode).toBe(409);
    expect(p.json().code).toBe('unverified');
    // Promoção feita direto no banco também não vale para a sessão não verificada.
    db.run("UPDATE users SET role = 'editor' WHERE id = ?", uid);
    expect((await app.inject({ url: '/api/v1/admin/overview', cookies: { jm_session: sess } })).statusCode).toBe(401);
  });

  it('promover conta verificada funciona e derruba as sessões anteriores dela', async () => {
    const { app, db } = await setup();
    const admin = await login(app, db, 'admin@example.com');
    const old = await login(app, db, 'leitor@example.com');
    const uid = db.get<{ id: string }>("SELECT id FROM users WHERE email = 'leitor@example.com'")!.id;
    const p = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${uid}`, headers: H, cookies: admin, payload: { role: 'editor' } });
    expect(p.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', cookies: old })).statusCode).toBe(401);
    const fresh = await login(app, db, 'leitor@example.com');
    expect((await app.inject({ url: '/api/v1/admin/overview', cookies: fresh })).statusCode).toBe(200);
  });

  it('id inexistente é 404', async () => {
    const { app, db } = await setup();
    const admin = await login(app, db, 'admin@example.com');
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/nao-existe', headers: H, cookies: admin, payload: { role: 'reader' } })).statusCode).toBe(404);
  });
});

describe('A2: só o rascunho mais novo pode ser publicado', () => {
  it('compor de novo aposenta o rascunho anterior da data', async () => {
    const { app, db } = await setup();
    const admin = await login(app, db, 'admin@example.com');
    const date = '2026-11-20';
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: `/api/v1/admin/editions/${date}/compose`, headers: H, cookies: admin });
    const rows = db.all<{ version: number; status: string }>('SELECT version, status FROM editions WHERE edition_date = ? AND is_demo = 0 ORDER BY version', date);
    expect(rows).toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'draft' }]);
  });
});

describe('A2: publicação presa ao rascunho da prévia', () => {
  it('ID antigo da prévia dá 409 e nada é publicado; ID atual passa da checagem; chamada sem ID segue por data', async () => {
    const { app, db } = await setup();
    const admin = await login(app, db, 'admin@example.com');
    const date = '2026-11-21';
    const compose = () => app.inject({ method: 'POST', url: `/api/v1/admin/editions/${date}/compose`, headers: H, cookies: admin });
    const publish = (payload?: object) => app.inject({ method: 'POST', url: `/api/v1/admin/editions/${date}/publish`, headers: H, cookies: admin, ...(payload ? { payload } : {}) });
    await compose();
    const oldId = (await app.inject({ url: `/api/v1/admin/editions/${date}/preview`, cookies: admin })).json().editionId;
    await compose();
    const r = await publish({ editionId: oldId });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('draft_changed');
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM editions WHERE edition_date = ? AND status = 'published'", date)!.n).toBe(0);
    const newId = (await app.inject({ url: `/api/v1/admin/editions/${date}/preview`, cookies: admin })).json().editionId;
    expect(newId).not.toBe(oldId);
    // Rascunho vazio: passa da checagem de ID e cai na regra seguinte (edição sem itens), igual à chamada sem ID.
    expect((await publish({ editionId: newId })).json().code).toBe('empty_edition');
    expect((await publish()).json().code).toBe('empty_edition');
  });

  it('prévia sem edição retorna 200 nulo e preserva 401/403 para não autenticado e leitor', async () => {
    const { app, db } = await setup();
    const admin = await login(app, db, 'admin@example.com');
    const reader = await login(app, db, 'leitor-previa@example.com');
    const date = '2026-11-22';

    expect((await app.inject({ url: `/api/v1/admin/editions/${date}/preview` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/v1/admin/editions/${date}/preview`, cookies: reader })).statusCode).toBe(403);

    const empty = await app.inject({ url: `/api/v1/admin/editions/${date}/preview`, cookies: admin });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ status: null, editionId: null, edition: null });

    await app.inject({ method: 'POST', url: `/api/v1/admin/editions/${date}/compose`, headers: H, cookies: admin });
    const present = await app.inject({ url: `/api/v1/admin/editions/${date}/preview`, cookies: admin });
    expect(present.statusCode).toBe(200);
    expect(present.json().status).toBe('draft');
    expect(present.json().editionId).toBeTruthy();
    expect(present.json().edition).toBeTruthy();
  });
});

describe('Sessão opcional (/api/v1/session)', () => {
  it('retorna 200 { user: null } sem sessão e mantém /me em 401', async () => {
    const { app, db } = await setup();
    const anon = await app.inject({ url: '/api/v1/session' });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['cache-control']).toBe('private, no-store');
    expect(anon.json()).toEqual({ user: null });
    expect((await app.inject({ url: '/api/v1/me' })).statusCode).toBe(401);

    const reader = await login(app, db, 'sessao@example.com');
    const auth = await app.inject({ url: '/api/v1/session', cookies: reader });
    expect(auth.statusCode).toBe(200);
    expect(auth.headers['cache-control']).toBe('private, no-store');
    expect(auth.json().user?.email).toBe('sessao@example.com');

    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: H, cookies: reader });
    const afterLogout = await app.inject({ url: '/api/v1/session', cookies: reader });
    expect(afterLogout.statusCode).toBe(200);
    expect(afterLogout.json()).toEqual({ user: null });
    expect((await app.inject({ url: '/api/v1/me', cookies: reader })).statusCode).toBe(401);
  });
});
