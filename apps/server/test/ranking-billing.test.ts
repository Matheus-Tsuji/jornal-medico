import { describe, expect, it } from 'vitest';
import { rankCandidates, recommend, type Candidate } from '../src/modules/ranking.ts';
import { isEntitledSub, signPayload } from '../src/modules/billing.ts';
import { H, login, setup } from './helpers.ts';

const cand = (id: string, topic: string, over: Partial<Candidate> = {}): Candidate => ({
  id, articleId: id, topics: [topic, 'cardiologia', 'clinica-medica'], primaryTopic: topic, source: 'pubmed', ageDays: 1, priority: 0.5, read: false, ...over,
});

describe('ranking explicável', () => {
  const pool = [
    cand('h1', 'hipertensao-arterial', { priority: 0.9 }), cand('h2', 'hipertensao-arterial'), cand('h3', 'hipertensao-arterial'),
    cand('d1', 'diabetes', { topics: ['diabetes', 'endocrinologia', 'clinica-medica'] }), cand('i1', 'insuficiencia-cardiaca', { ageDays: 20 }),
  ];
  it('cold start: seleção geral, por prioridade/recência', () => {
    const r = rankCandidates(pool, { topics: [], sources: [], lessTopics: [], personalization: true }, 3);
    expect(r[0]!.id).toBe('h1');
    expect(r[0]!.reasons).toContain('Seleção geral');
  });
  it('preferência muda a ordem e explica o motivo', () => {
    const r = rankCandidates(pool, { topics: ['diabetes'], sources: [], lessTopics: [], personalization: true }, 3);
    expect(r[0]!.id).toBe('d1');
    expect(r[0]!.reasons.join()).toMatch(/Você segue/);
  });
  it('opt-out de personalização ignora preferências', () => {
    const r = rankCandidates(pool, { topics: ['diabetes'], sources: [], lessTopics: [], personalization: false }, 3);
    expect(r[0]!.id).toBe('h1');
  });
  it('diversidade: máximo 2 por tema e um item fora dos temas seguidos', () => {
    const r = rankCandidates(pool, { topics: ['hipertensao-arterial'], sources: [], lessTopics: [], personalization: true }, 3);
    expect(r.filter((x) => x.id.startsWith('h')).length).toBeLessThanOrEqual(2);
    expect(r.some((x) => !x.id.startsWith('h'))).toBe(true);
  });
  it('"menos deste tema" reduz o peso', () => {
    const r = rankCandidates(pool, { topics: [], sources: [], lessTopics: ['hipertensao-arterial'], personalization: true }, 5);
    expect(r[0]!.id).not.toMatch(/^h/);
  });
  it('retratados ficam fora dos candidatos; serviço Python fora do ar cai no baseline', async () => {
    const { db, cfg } = await setup({ RECOMMENDER_URL: 'http://127.0.0.1:9' });
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    const r = await recommend(db, cfg, null, 10, down);
    expect(r.engine).toBe('baseline-ts-v1');
    const retracted = db.get<{ id: string }>("SELECT a.id FROM analyses a JOIN articles ar ON ar.id = a.article_id WHERE ar.retraction_status = 'retracted'")!.id;
    expect(r.ranked.map((x) => x.id)).not.toContain(retracted);
    const bogus = (async () => new Response(JSON.stringify({ ranked: [{ id: 'inventado', score: 1, reasons: [] }] }))) as unknown as typeof fetch;
    expect((await recommend(db, cfg, null, 10, bogus)).engine).toBe('baseline-ts-v1');
  });
});

describe('assinatura sandbox', () => {
  it('checkout → pagamento simulado → entitlement; paywall bloqueia análise sem assinatura', async () => {
    const { app, db } = await setup({ PAYWALL_ENABLED: 'true' });
    const ck = await login(app, db, 'assinante@example.com');
    const locked = (await app.inject({ url: '/api/v1/articles/demo-001', cookies: ck })).json();
    expect(locked.locked).toBe(true);
    expect(locked.analysis).toBeNull();
    expect(locked.summary).toBeTruthy();
    const plan = (await app.inject({ url: '/api/v1/billing/plans' })).json().items[0];
    expect(plan.priceCents).toBe(4990);
    const co = (await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: ck, payload: { planId: plan.id } })).json();
    const sub = new URL(co.url, 'http://x').searchParams.get('sub')!;
    // retorno do checkout sozinho não ativa nada
    expect((await app.inject({ url: '/api/v1/billing/subscription', cookies: ck })).json().status).toBe('incomplete');
    const done = await app.inject({ method: 'POST', url: '/api/v1/billing/sandbox/complete', headers: H, cookies: ck, payload: { subscription: sub, outcome: 'approved' } });
    expect(done.json().status).toBe('active');
    expect((await app.inject({ url: '/api/v1/articles/demo-001', cookies: ck })).json().locked).toBe(false);
  });

  it('webhook: assinatura inválida rejeitada; evento duplicado ignorado; acesso cruzado bloqueado', async () => {
    const { app, db, cfg } = await setup();
    const a = await login(app, db, 'a@example.com');
    const b = await login(app, db, 'b@example.com');
    const plan = (await app.inject({ url: '/api/v1/billing/plans' })).json().items[0];
    const sub = new URL((await app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: H, cookies: a, payload: { planId: plan.id } })).json().url, 'http://x').searchParams.get('sub')!;
    const cross = await app.inject({ method: 'POST', url: '/api/v1/billing/sandbox/complete', headers: H, cookies: b, payload: { subscription: sub, outcome: 'approved' } });
    expect(cross.statusCode).toBe(404);
    const raw = JSON.stringify({ id: 'evt_1', type: 'subscription.activated', data: { subscriptionId: sub } });
    const bad = await app.inject({ method: 'POST', url: '/api/v1/billing/webhook/sandbox', headers: { 'content-type': 'application/json', 'x-webhook-signature': 'sha256=deadbeef' }, payload: raw });
    expect(bad.statusCode).toBe(401);
    const sig = signPayload(cfg.PAYMENT_WEBHOOK_SECRET!, raw);
    const ok1 = await app.inject({ method: 'POST', url: '/api/v1/billing/webhook/sandbox', headers: { 'content-type': 'application/json', 'x-webhook-signature': sig }, payload: raw });
    expect(ok1.json()).toEqual({ duplicate: false });
    const ok2 = await app.inject({ method: 'POST', url: '/api/v1/billing/webhook/sandbox', headers: { 'content-type': 'application/json', 'x-webhook-signature': sig }, payload: raw });
    expect(ok2.json()).toEqual({ duplicate: true });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM billing_events')!.n).toBe(1);
  });

  it('entitlement expira no fim do período; past_due tem carência', async () => {
    const { cfg } = await setup();
    const now = Date.parse('2026-11-14T00:00:00Z');
    expect(isEntitledSub({ status: 'active', current_period_end: '2026-11-13T00:00:00Z' }, cfg, now)).toBe(false);
    expect(isEntitledSub({ status: 'active', current_period_end: '2026-11-20T00:00:00Z' }, cfg, now)).toBe(true);
    expect(isEntitledSub({ status: 'past_due', current_period_end: '2026-11-12T00:00:00Z' }, cfg, now)).toBe(true); // 3 dias de carência
    expect(isEntitledSub({ status: 'past_due', current_period_end: '2026-11-01T00:00:00Z' }, cfg, now)).toBe(false);
    expect(isEntitledSub({ status: 'canceled', current_period_end: '2026-12-01T00:00:00Z' }, cfg, now)).toBe(false);
  });
});
