// Administração editorial. Papel verificado no servidor em toda rota.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, reviewDecisionInput, adminIngestionInput, adminProcessJobsInput, adminPublishEditionInput, adminReportInput, adminFlagInput, adminPlanInput, adminUserInput } from '@jm/contracts';
import { AppError, localDate, nowIso } from '../lib/util.ts';
import { loadPricing } from '../ai/analysis.ts';
import { audit, IMPLEMENTED_FLAGS } from '../modules/audit.ts';
import { listPlans } from '../modules/billing.ts';
import { editionDto } from '../modules/content.ts';
import { composeEdition, decide, publishEdition, reviewDetail, reviewQueue } from '../modules/editorial.ts';
import { automaticSources, importOfficial, officialInput } from '../modules/monitor.ts';
import { enqueue, requeue } from '../modules/jobs.ts';
import { defaultDeps, workOnce } from '../worker/runner.ts';
import { requireRole, type Ctx } from './app.ts';

const dateParam = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function adminRoutes(app: FastifyInstance, { db, cfg }: Ctx) {
  const editor = (req: Parameters<typeof requireRole>[0]) => requireRole(req, 'editor', 'admin');
  const admin = (req: Parameters<typeof requireRole>[0]) => requireRole(req, 'admin');

  app.post('/admin/monitor/sync', async (req) => {
    const u = editor(req);
    const { source } = z.object({ source: z.string().refine((s) => automaticSources.includes(s)) }).parse(req.body);
    const job = enqueue(db, 'monitor', `monitor:${source}:${Math.floor(Date.now() / 3600000)}`, { source });
    audit(db, u.id, 'monitor.queued', 'job', job.id, { source });
    return job;
  });
  app.post('/admin/monitor/documents', async (req) => {
    const u = editor(req);
    const item = importOfficial(db, officialInput.parse(req.body));
    audit(db, u.id, 'monitor.imported', 'document', item.id, { source: item.source });
    return item;
  });

  app.get('/admin/overview', async (req) => {
    editor(req);
    const count = (sql: string) => db.get<{ n: number }>(sql)!.n;
    return {
      reviews: Object.fromEntries(db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM analyses GROUP BY status').map((r) => [r.status, r.n])),
      jobs: Object.fromEntries(db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').map((r) => [r.status, r.n])),
      articles: { total: count('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 0'), eligible: count("SELECT COUNT(*) AS n FROM articles WHERE is_demo = 0 AND triage_status = 'eligible'") },
      openReports: count("SELECT COUNT(*) AS n FROM error_reports WHERE status IN ('open','investigating')"),
      duplicateCandidates: count("SELECT COUNT(*) AS n FROM duplicate_candidates WHERE status = 'open'"),
      ai: { configured: !!cfg.OPENAI_API_KEY, analysisModel: cfg.OPENAI_ANALYSIS_MODEL ?? null, editorialModel: cfg.OPENAI_EDITORIAL_MODEL ?? null },
      today: localDate(cfg.APP_TIMEZONE),
    };
  });

  // ---------- Revisão ----------
  app.get('/admin/reviews', async (req) => {
    editor(req);
    const { status } = z.object({ status: z.enum(['in_review', 'blocked', 'rejected', 'published', 'superseded', 'demo']).optional() }).parse(req.query);
    return { items: reviewQueue(db, status) };
  });
  app.get('/admin/reviews/:id', async (req) => {
    editor(req);
    return reviewDetail(db, idParam.parse(req.params).id);
  });
  app.post('/admin/reviews/:id/decision', async (req) => {
    const u = editor(req);
    const { id } = idParam.parse(req.params);
    return decide(db, u, id, reviewDecisionInput.parse(req.body));
  });

  // ---------- Ingestão e jobs ----------
  app.post('/admin/ingestion/run', async (req) => {
    const u = editor(req);
    const { topic } = adminIngestionInput.parse(req.body ?? {});
    const topics = db.all<{ slug: string }>(
      `SELECT slug FROM topics WHERE enabled = 1 AND source_query IS NOT NULL ${topic ? 'AND slug = ?' : ''}`, ...(topic ? [topic] : []),
    );
    if (!topics.length) throw new AppError(404, 'topic_not_found', 'Nenhum tema habilitado com consulta.');
    const stamp = nowIso().slice(0, 16);
    const jobs = topics.map((t) => enqueue(db, 'discover', `discover:pubmed:${t.slug}:manual:${stamp}`, { topic: t.slug }));
    audit(db, u.id, 'ingestion.requested', 'topic', topic ?? '*', { jobs: jobs.length });
    return { jobs, note: 'Jobs enfileirados. O worker (npm run worker) processa; ou use "Processar fila agora".' };
  });
  app.post('/admin/jobs/process', async (req) => {
    const u = editor(req);
    const { max } = adminProcessJobsInput.parse(req.body ?? {});
    const deps = defaultDeps(db, cfg);
    let n = 0;
    // Evita iniciar mais trabalho quando a resposta já consumiu seu orçamento.
    const deadline = Date.now() + 25_000;
    while (n < Math.min(max, 3) && Date.now() < deadline && (await workOnce(db, cfg, deps, `api:${u.id}`))) n++;
    return { processed: n };
  });
  app.get('/admin/jobs', async (req) => {
    editor(req);
    const { status } = z.object({ status: z.string().max(20).optional() }).parse(req.query);
    return {
      items: db.all(
        `SELECT id, type, idempotency_key, status, attempts, max_attempts, next_run_at, last_error, result, updated_at FROM jobs ${status ? 'WHERE status = ?' : ''} ORDER BY updated_at DESC LIMIT 100`,
        ...(status ? [status] : []),
      ),
      runs: db.all('SELECT r.*, t.slug AS topic FROM ingestion_runs r LEFT JOIN topics t ON t.id = r.topic_id ORDER BY started_at DESC LIMIT 30'),
    };
  });
  app.post('/admin/jobs/:id/retry', async (req) => {
    const u = editor(req);
    const { id } = idParam.parse(req.params);
    if (Number(requeue(db, id).changes) !== 1) throw new AppError(409, 'not_retryable', 'Apenas jobs falhos ou bloqueados podem ser reprocessados.');
    audit(db, u.id, 'job.requeued', 'job', id);
    return { ok: true };
  });

  // ---------- Edições ----------
  app.get('/admin/editions', async (req) => {
    editor(req);
    return { items: db.all('SELECT e.*, (SELECT COUNT(*) FROM edition_items i WHERE i.edition_id = e.id) AS items FROM editions e ORDER BY edition_date DESC, version DESC LIMIT 60') };
  });
  app.post('/admin/editions/:date/compose', async (req) => {
    const u = editor(req);
    const { date } = dateParam.parse(req.params);
    const r = composeEdition(db, date);
    audit(db, u.id, 'edition.composed', 'edition', r.editionId, { date, items: r.items });
    return r;
  });
  app.get('/admin/editions/:date/preview', async (req) => {
    const u = editor(req);
    const { date } = dateParam.parse(req.params);
    const e = db.get("SELECT * FROM editions WHERE edition_date = ? AND is_demo = 0 ORDER BY version DESC LIMIT 1", date);
    if (!e) return { status: null, editionId: null, edition: null };
    return { status: e.status, editionId: e.id as string, edition: editionDto(db, e, u.id) };
  });
  app.post('/admin/editions/:date/publish', async (req) => {
    const u = editor(req);
    // editionId (opcional): o rascunho exibido na prévia. Sem ele, publica o rascunho mais novo da data
    // (compatibilidade com chamadas antigas por data); com ele, 409 se o rascunho mudou desde a prévia.
    const { editionId } = adminPublishEditionInput.parse(req.body ?? {});
    return publishEdition(db, u, dateParam.parse(req.params).date, editionId);
  });

  // ---------- Fontes, custos, relatos ----------
  app.get('/admin/sources', async (req) => {
    editor(req);
    return { items: db.all('SELECT slug, name, kind, status, enabled, official_url, license_notes, last_success_at, last_error, rate_limit_per_sec FROM sources ORDER BY enabled DESC, name') };
  });
  app.get('/admin/ai-usage', async (req) => {
    editor(req);
    const p = loadPricing();
    return {
      pricing: { version: p.version, configuredModels: Object.keys(p.models), note: p.version ? 'Custo estimado por tokens × tabela versionada. Confira a cobrança real no painel da OpenAI.' : 'Tabela de preços não configurada (apps/server/config/ai-pricing.json): custos não calculados.' },
      byDay: db.all(
        `SELECT substr(created_at, 1, 10) AS day, task, model, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(cached_tokens) AS cached_tokens,
                SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd, COUNT(DISTINCT article_id) AS articles
           FROM ai_usage GROUP BY day, task, model ORDER BY day DESC LIMIT 90`,
      ),
      totals: db.get(
        `SELECT COUNT(DISTINCT article_id) AS processed, SUM(cost_usd) AS cost_usd,
                (SELECT COUNT(*) FROM analyses WHERE status = 'published' AND is_demo = 0) AS approved FROM ai_usage`,
      ),
      budget: { dailyUsd: cfg.AI_DAILY_BUDGET_USD ?? null, monthlyUsd: cfg.AI_MONTHLY_BUDGET_USD ?? null, maxArticlesPerDay: cfg.AI_MAX_ARTICLES_PER_DAY },
    };
  });
  app.get('/admin/reports', async (req) => {
    editor(req);
    return { items: db.all('SELECT r.id, r.message, r.status, r.created_at, a.slug, a.original_title FROM error_reports r JOIN articles a ON a.id = r.article_id ORDER BY r.created_at DESC LIMIT 100') };
  });
  app.patch('/admin/reports/:id', async (req) => {
    const u = editor(req);
    const { id } = idParam.parse(req.params);
    const { status } = adminReportInput.parse(req.body);
    db.run('UPDATE error_reports SET status = ? WHERE id = ?', status, id);
    audit(db, u.id, 'report.status', 'report', id, { status });
    return { ok: true };
  });

  // ---------- Somente admin ----------
  app.get('/admin/flags', async (req) => {
    admin(req);
    return { items: db.all('SELECT key, enabled, description, updated_at FROM feature_flags ORDER BY key') };
  });
  app.patch('/admin/flags/:key', async (req) => {
    const u = admin(req);
    const { key } = z.object({ key: z.string().max(40) }).parse(req.params);
    const { enabled } = adminFlagInput.parse(req.body);
    if (enabled && !IMPLEMENTED_FLAGS.includes(key)) throw new AppError(409, 'not_implemented', 'Esta integração ainda não foi implementada; a flag não pode ser ligada.');
    if (Number(db.run('UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?', enabled ? 1 : 0, nowIso(), key).changes) !== 1) throw new AppError(404, 'not_found', 'Flag inexistente.');
    audit(db, u.id, 'flag.changed', 'flag', key, { enabled });
    return { ok: true };
  });
  app.get('/admin/plans', async (req) => {
    admin(req);
    return { items: listPlans(db, true) };
  });
  app.patch('/admin/plans/:id', async (req) => {
    const u = admin(req);
    const { id } = idParam.parse(req.params);
    const body = adminPlanInput.parse(req.body);
    db.run(
      'UPDATE plans SET name = COALESCE(?, name), price_cents = COALESCE(?, price_cents), active = COALESCE(?, active) WHERE id = ?',
      body.name ?? null, body.priceCents ?? null, body.active === undefined ? null : body.active ? 1 : 0, id,
    );
    audit(db, u.id, 'plan.changed', 'plan', id, body);
    return { items: listPlans(db, true) };
  });
  app.get('/admin/users', async (req) => {
    admin(req);
    return { items: db.all('SELECT id, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 200') };
  });
  app.patch('/admin/users/:id', async (req) => {
    const u = admin(req);
    const { id } = idParam.parse(req.params);
    const body = adminUserInput.parse(req.body);
    if (id === u.id) throw new AppError(409, 'self_change', 'Você não pode alterar o próprio papel ou status.');
    // Checagem do alvo, papel, revogação e auditoria numa transação só: nada fica pela metade nem entre leitura e escrita.
    return db.tx(() => {
      const target = db.get<{ role: string; verified_at: string | null }>('SELECT role, verified_at FROM users WHERE id = ? AND is_guest = 0', id);
      if (!target) throw new AppError(404, 'not_found', 'Usuário não encontrado.');
      // Equipe só com e-mail comprovado: senão a sessão de quem cadastrou o e-mail alheio por senha herdaria o papel.
      if (body.role && body.role !== 'reader' && !target.verified_at) throw new AppError(409, 'unverified', 'O usuário precisa comprovar o e-mail (login por código) antes de virar editor ou admin.');
      db.run('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?', body.role ?? null, body.status ?? null, id);
      if (body.status === 'disabled' || (body.role && body.role !== target.role)) db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), id);
      audit(db, u.id, 'user.changed', 'user', id, body);
      return { ok: true };
    });
  });
  app.get('/admin/audit', async (req) => {
    admin(req);
    return { items: db.all('SELECT a.action, a.target_type, a.target_id, a.detail, a.created_at, u.email AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200') };
  });
}
