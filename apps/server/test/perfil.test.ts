import { describe, expect, it } from 'vitest';
import { H, login, setup } from './helpers.ts';

const details = {
  headline: 'Clínica médica', about: 'Texto de teste (fictício).', education: ['Graduação em Medicina'], certificates: ['Curso fictício'],
  publications: [{ title: 'Publicação fictícia', venue: 'Periódico fictício', year: 2025, url: 'https://doi.org/10.99999/demo' }],
  socials: { linkedin: 'https://www.linkedin.com/in/ficticio', instagram: null, orcid: null, lattes: null }, isPublic: false,
};

describe('perfil profissional e perfil público', () => {
  it('salva o próprio perfil; outro usuário só vê se for público, e nunca o e-mail', async () => {
    const { app, db } = await setup();
    const ana = await login(app, db, 'ana@example.com');
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/me/details', headers: H, cookies: ana, payload: details });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().details.about).toBe('Texto de teste (fictício).');
    const id = saved.json().id as string;

    expect((await app.inject({ url: `/api/v1/profiles/${id}` })).statusCode).toBe(404); // privado
    await app.inject({ method: 'PUT', url: '/api/v1/me/details', headers: H, cookies: ana, payload: { ...details, isPublic: true } });
    const pub = await app.inject({ url: `/api/v1/profiles/${id}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().publications[0].title).toBe('Publicação fictícia');
    expect(pub.body).not.toContain('ana@example.com');
  });

  it('recusa link não https e visitante não edita perfil', async () => {
    const { app, db } = await setup();
    const c = await login(app, db, 'b@example.com');
    const bad = await app.inject({ method: 'PUT', url: '/api/v1/me/details', headers: H, cookies: c, payload: { ...details, socials: { ...details.socials, linkedin: 'javascript:alert(1)' } } });
    expect(bad.statusCode).toBe(400);
    const g = (await app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: H })).cookies.find((x) => x.name === 'jm_session')!.value;
    expect((await app.inject({ method: 'PUT', url: '/api/v1/me/details', headers: H, cookies: { jm_session: g }, payload: details })).statusCode).toBe(403);
  });
});
