import { describe, expect, it } from 'vitest';
import { analyzeArticle } from '../src/ai/analysis.ts';
import { discover } from '../src/worker/ingestion.ts';
import { H, fakeAdapter, fakeProvider, login, setup, validEditorial, validExtraction } from './helpers.ts';

const AI = { OPENAI_API_KEY: 'test-key-not-real', OPENAI_ANALYSIS_MODEL: 'gpt-6.1-terra', OPENAI_EDITORIAL_MODEL: 'gpt-6-luna' };

async function withReview() {
  const ctx = await setup(AI);
  await discover(ctx.db, ctx.cfg, fakeAdapter(), 'hipertensao-arterial');
  const articleId = ctx.db.get<{ id: string }>("SELECT id FROM articles WHERE pmid = '99999901'")!.id;
  const r = await analyzeArticle(ctx.db, ctx.cfg, fakeProvider([validExtraction(), validEditorial]), articleId);
  const admin = await login(ctx.app, ctx.db, 'admin@example.com');
  return { ...ctx, articleId, analysisId: r.analysisId, admin };
}

describe('fluxo editorial', () => {
  it('conteúdo em revisão não chega ao leitor; publicação sem aprovação é bloqueada', async () => {
    const { app, db, admin } = await withReview();
    db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'real_content'");
    expect((await app.inject({ url: '/api/v1/articles?limit=50' })).json().items).toEqual([]);
    // compõe sem itens aprovados → rascunho vazio, publicação recusada
    const date = '2026-11-14';
    const c = await app.inject({ method: 'POST', url: `/api/v1/admin/editions/${date}/compose`, headers: H, cookies: admin });
    expect(c.json().items).toBe(0);
    const p = await app.inject({ method: 'POST', url: `/api/v1/admin/editions/${date}/publish`, headers: H, cookies: admin });
    expect(p.statusCode).toBe(409);
  });

  it('leitor não revisa; editor aprova com justificativa, edição é composta e publicada', async () => {
    const { app, db, admin, analysisId } = await withReview();
    const reader = await login(app, db, 'leitor@example.com');
    const forbidden = await app.inject({ method: 'POST', url: `/api/v1/admin/reviews/${analysisId}/decision`, headers: H, cookies: reader, payload: { decision: 'approve', justification: 'ok ok' } });
    expect(forbidden.statusCode).toBe(403);
    const noJust = await app.inject({ method: 'POST', url: `/api/v1/admin/reviews/${analysisId}/decision`, headers: H, cookies: admin, payload: { decision: 'approve', justification: '' } });
    expect(noJust.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST', url: `/api/v1/admin/reviews/${analysisId}/decision`, headers: H, cookies: admin,
      payload: { decision: 'approve', justification: 'Números conferidos com o abstract.', edits: { inShort: 'Texto revisado pelo editor responsável.' } },
    });
    expect(ok.statusCode).toBe(200);
    const rev = db.get<{ reviewer_id: string; created_at: string }>('SELECT reviewer_id, created_at FROM editorial_reviews WHERE analysis_id = ?', analysisId)!;
    expect(rev.reviewer_id).toBeTruthy();
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'review.approve'")!.n).toBe(1);
    // decisão repetida não é permitida (análise publicada é imutável)
    const twice = await app.inject({ method: 'POST', url: `/api/v1/admin/reviews/${analysisId}/decision`, headers: H, cookies: admin, payload: { decision: 'reject', justification: 'mudei de ideia' } });
    expect(twice.statusCode).toBe(409);

    const today = new Date().toISOString().slice(0, 10);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/editions/${today}/compose`, headers: H, cookies: admin })).json().items).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/editions/${today}/publish`, headers: H, cookies: admin })).statusCode).toBe(200);
    db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'real_content'");
    const ed = (await app.inject({ url: '/api/v1/editions/latest' })).json().edition;
    expect(ed.isDemo).toBe(false);
    expect(ed.headline.headline).toBe(validEditorial.editorialHeadline);
    expect(ed.headline.inShort).toBe('Texto revisado pelo editor responsável.');
    const detail = (await app.inject({ url: `/api/v1/articles/${ed.headline.slug}` })).json();
    expect(detail.pmid).toBe('99999901');
    expect(detail.doi).toBe('10.99999/syn.0001');
    expect(detail.reviewedAt).toBeTruthy();
    expect(detail.analysis.results[0].pValue.raw).toBe('P=0.02');
  });

  it('correção cria nova versão; anterior vira superseded e aviso fica visível', async () => {
    const { app, db, admin, analysisId, articleId, cfg } = await withReview();
    await app.inject({ method: 'POST', url: `/api/v1/admin/reviews/${analysisId}/decision`, headers: H, cookies: admin, payload: { decision: 'approve', justification: 'Conferido.' } });
    // nova versão (ex.: prompt corrigido)
    db.run("UPDATE article_sources SET abstract_text = abstract_text || ' Updated.' WHERE article_id = ?", articleId);
    const r2 = await analyzeArticle(db, cfg, fakeProvider([validExtraction(), validEditorial]), articleId);
    await app.inject({ method: 'POST', url: `/api/v1/admin/reviews/${r2.analysisId}/decision`, headers: H, cookies: admin, payload: { decision: 'approve', justification: 'Correção do resumo.' } });
    expect(db.get<{ status: string }>('SELECT status FROM analyses WHERE id = ?', analysisId)!.status).toBe('superseded');
    db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'real_content'");
    const slug = db.get<{ slug: string }>('SELECT slug FROM articles WHERE id = ?', articleId)!.slug;
    const d = (await app.inject({ url: `/api/v1/articles/${slug}` })).json();
    expect(d.analysisVersion).toBe(2);
    expect(d.reviewStatus).toBe('corrected');
    expect(d.corrections[0].note).toMatch(/versão 2/);
  });

  it('artigo retratado não pode ser aprovado', async () => {
    const { app, db, admin, analysisId, articleId } = await withReview();
    db.run("UPDATE articles SET retraction_status = 'retracted' WHERE id = ?", articleId);
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/reviews/${analysisId}/decision`, headers: H, cookies: admin, payload: { decision: 'approve', justification: 'Conferido.' } });
    expect(r.statusCode).toBe(409);
  });

  it('flags de integrações não implementadas não podem ser ligadas', async () => {
    const { app, admin } = await withReview();
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/flags/audio', headers: H, cookies: admin, payload: { enabled: true } })).statusCode).toBe(409);
  });
});

describe('prévia de IA (flag ai_preview)', () => {
  it('desligada esconde análises em revisão; ligada mostra com rótulo e monta prévia', async () => {
    const { app, db } = await withReview();
    db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'real_content'");
    expect((await app.inject({ url: '/api/v1/articles?limit=50' })).json().items).toEqual([]);
    db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'ai_preview'");
    const items = (await app.inject({ url: '/api/v1/articles?limit=50' })).json().items;
    expect(items.length).toBe(1);
    expect(items[0].reviewStatus).toBe('ai_unreviewed');
    const ed = (await app.inject({ url: '/api/v1/editions/latest' })).json().edition;
    expect(ed.isPreview).toBe(true);
    expect(ed.headline.reviewStatus).toBe('ai_unreviewed');
    // a prévia nunca vira edição publicada sem aprovação
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM editions WHERE is_demo = 0")!.n).toBe(0);
  });
});
