// Rotas do leitor autenticado: perfil, preferências, acervo pessoal, eventos, privacidade.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { topicSlugParam, errorReportInput, feedbackInput, followTopicInput, readEventInput, updateMeInput, updatePreferencesInput, type Me } from '@jm/contracts';
import { AppError, id, localDate, nowIso } from '../lib/util.ts';
import { audit } from '../modules/audit.ts';
import { revokeAllSessions } from '../modules/auth.ts';
import { entitled } from '../modules/billing.ts';
import { cardMap, visibleAnalysisIdsForArticles } from '../modules/content.ts';
import { requireUser, setSessionCookie, type Ctx } from './app.ts';

const MAX_REPORTS_PER_DAY = 10;

export async function userRoutes(app: FastifyInstance, { db, cfg }: Ctx) {
  const me = (userId: string): Me => {
    const u = db.get('SELECT * FROM users WHERE id = ?', userId)!;
    return {
      id: u.id as string,
      email: u.is_guest === 1 ? '' : (u.email as string),
      isGuest: u.is_guest === 1,
      role: u.role as Me['role'],
      profile: (u.profile as string) ?? null,
      displayName: (u.display_name as string) ?? null,
      personalizationEnabled: u.personalization_enabled === 1,
      onboarded: !!u.onboarded_at,
      entitled: entitled(db, cfg, { id: userId, role: u.role as string }),
      preferences: {
        topics: db.all<{ slug: string }>('SELECT t.slug FROM user_preferences p JOIN topics t ON t.id = p.topic_id WHERE p.user_id = ? AND p.follow = 1', userId).map((r) => r.slug),
        sources: db.all<{ slug: string }>('SELECT s.slug FROM user_preferences p JOIN sources s ON s.id = p.source_id WHERE p.user_id = ? AND p.follow = 1', userId).map((r) => r.slug),
      },
    };
  };

  app.get('/me', async (req) => me(requireUser(req).id));

  // Consulta opcional de sessão para páginas públicas: evita 401 esperado no console mantendo /me restrito.
  app.get('/session', async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    return { user: req.user ? me(req.user.id) : null };
  });

  app.patch('/me', async (req) => {
    const u = requireUser(req);
    const body = updateMeInput.parse(req.body);
    if (body.profile !== undefined) db.run('UPDATE users SET profile = ? WHERE id = ?', body.profile, u.id);
    if (body.personalizationEnabled !== undefined) db.run('UPDATE users SET personalization_enabled = ? WHERE id = ?', body.personalizationEnabled ? 1 : 0, u.id);
    if (body.onboarded) db.run('UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?', nowIso(), u.id);
    return me(u.id);
  });

  app.get('/me/preferences', async (req) => me(requireUser(req).id).preferences);

  app.patch('/me/preferences', async (req) => {
    const u = requireUser(req);
    const body = updatePreferencesInput.parse(req.body);
    db.tx(() => {
      // Só temas habilitados podem ser seguidos.
      const topicIds = body.topics.length
        ? db.all<{ id: string }>(`SELECT id FROM topics WHERE enabled = 1 AND slug IN (${body.topics.map(() => '?').join(',')})`, ...body.topics).map((r) => r.id)
        : [];
      const sourceIds = body.sources.length
        ? db.all<{ id: string }>(`SELECT id FROM sources WHERE slug IN (${body.sources.map(() => '?').join(',')})`, ...body.sources).map((r) => r.id)
        : [];
      db.run('DELETE FROM user_preferences WHERE user_id = ?', u.id);
      for (const t of topicIds) db.run('INSERT INTO user_preferences (id, user_id, topic_id, created_at, updated_at) VALUES (?,?,?,?,?)', id(), u.id, t, nowIso(), nowIso());
      for (const s of sourceIds) db.run('INSERT INTO user_preferences (id, user_id, source_id, created_at, updated_at) VALUES (?,?,?,?,?)', id(), u.id, s, nowIso(), nowIso());
    });
    return me(u.id).preferences;
  });

  app.post('/topics/:slug/follow', async (req) => {
    const u = requireUser(req);
    const { slug } = topicSlugParam.parse(req.params);
    const { follow } = followTopicInput.parse(req.body);
    const t = db.get<{ id: string }>('SELECT id FROM topics WHERE slug = ? AND enabled = 1', slug);
    if (!t) throw new AppError(404, 'topic_not_found', 'Tema indisponível.');
    if (follow) db.run('INSERT OR IGNORE INTO user_preferences (id, user_id, topic_id, created_at, updated_at) VALUES (?,?,?,?,?)', id(), u.id, t.id, nowIso(), nowIso());
    else db.run('DELETE FROM user_preferences WHERE user_id = ? AND topic_id = ?', u.id, t.id);
    return { follow };
  });

  // ---------- Acervo pessoal ----------
  const cardsForArticles = (userId: string, articleIds: string[]) => {
    const m = visibleAnalysisIdsForArticles(db, articleIds);
    const cm = cardMap(db, [...m.values()], userId);
    return articleIds.flatMap((a) => { const aid = m.get(a); const c = aid ? cm.get(aid) : undefined; return c ? [c] : []; });
  };

  app.get('/bookmarks', async (req) => {
    const u = requireUser(req);
    const ids = db.all<{ article_id: string }>('SELECT article_id FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', u.id).map((r) => r.article_id);
    return { items: cardsForArticles(u.id, ids) };
  });
  app.post('/bookmarks', async (req) => {
    const u = requireUser(req);
    const { articleId } = z.strictObject({ articleId: z.string().max(64) }).parse(req.body);
    if (!visibleAnalysisIdsForArticles(db, [articleId]).size) throw new AppError(404, 'not_found', 'Artigo não encontrado.');
    db.run('INSERT OR IGNORE INTO bookmarks (user_id, article_id, created_at) VALUES (?,?,?)', u.id, articleId, nowIso());
    return { bookmarked: true };
  });
  app.delete('/bookmarks/:articleId', async (req) => {
    const u = requireUser(req);
    const { articleId } = z.object({ articleId: z.string().max(64) }).parse(req.params);
    db.run('DELETE FROM bookmarks WHERE user_id = ? AND article_id = ?', u.id, articleId);
    return { bookmarked: false };
  });

  app.get('/history', async (req) => {
    const u = requireUser(req);
    const ids = db.all<{ article_id: string }>(
      'SELECT article_id, MAX(created_at) AS last FROM read_events WHERE user_id = ? GROUP BY article_id ORDER BY last DESC LIMIT 200', u.id,
    ).map((r) => r.article_id);
    return { items: cardsForArticles(u.id, ids) };
  });
  app.delete('/me/history', async (req) => {
    const u = requireUser(req);
    db.tx(() => {
      db.run('DELETE FROM read_events WHERE user_id = ?', u.id);
      db.run('DELETE FROM feedback WHERE user_id = ?', u.id);
    });
    return { ok: true };
  });

  // ---------- Eventos e retorno ----------
  app.post('/events/read', async (req) => {
    const u = requireUser(req);
    const { articleId, kind } = readEventInput.parse(req.body);
    if (!visibleAnalysisIdsForArticles(db, [articleId]).size) throw new AppError(404, 'not_found', 'Artigo não encontrado.');
    // Deduplicado por usuário/artigo/tipo/dia.
    db.run('INSERT OR IGNORE INTO read_events (id, user_id, article_id, kind, day, created_at) VALUES (?,?,?,?,?,?)', id(), u.id, articleId, kind, localDate(cfg.APP_TIMEZONE), nowIso());
    return { ok: true };
  });
  app.post('/feedback', async (req) => {
    const u = requireUser(req);
    const { articleId, value } = feedbackInput.parse(req.body);
    if (!db.get('SELECT 1 FROM articles WHERE id = ?', articleId)) throw new AppError(404, 'not_found', 'Artigo não encontrado.');
    db.run(
      'INSERT INTO feedback (id, user_id, article_id, value, created_at) VALUES (?,?,?,?,?) ON CONFLICT (user_id, article_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at',
      id(), u.id, articleId, value, nowIso(),
    );
    return { ok: true };
  });
  app.post('/reports', async (req) => {
    const u = requireUser(req);
    if (u.isGuest) throw new AppError(403, 'guest_needs_email', 'Para relatar um erro, entre com sua conta.');
    const { articleId, message } = errorReportInput.parse(req.body);
    const today = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM error_reports WHERE user_id = ? AND created_at > ?', u.id, new Date(Date.now() - 86_400_000).toISOString())!.n;
    if (today >= MAX_REPORTS_PER_DAY) throw new AppError(429, 'rate_limited', 'Limite diário de relatos atingido. Tente amanhã.');
    if (!db.get('SELECT 1 FROM articles WHERE id = ?', articleId)) throw new AppError(404, 'not_found', 'Artigo não encontrado.');
    const rid = id();
    db.run('INSERT INTO error_reports (id, user_id, article_id, message, created_at) VALUES (?,?,?,?,?)', rid, u.id, articleId, message, nowIso());
    audit(db, u.id, 'report.created', 'article', articleId);
    return { ok: true, id: rid, message: 'Obrigado. A equipe editorial vai investigar.' };
  });

  // ---------- Privacidade (LGPD: acesso, portabilidade, eliminação) ----------
  app.get('/me/export', async (req, reply) => {
    const u = requireUser(req);
    reply.header('content-disposition', 'attachment; filename="meus-dados-jornal-medico.json"');
    return {
      exportedAt: nowIso(),
      user: db.get('SELECT CASE WHEN is_guest = 1 THEN NULL ELSE email END AS email, display_name, verified_at, is_guest, role, profile, personalization_enabled, onboarded_at, created_at FROM users WHERE id = ?', u.id),
      preferences: me(u.id).preferences,
      bookmarks: db.all('SELECT article_id, created_at FROM bookmarks WHERE user_id = ?', u.id),
      readEvents: db.all('SELECT article_id, kind, day FROM read_events WHERE user_id = ?', u.id),
      feedback: db.all('SELECT article_id, value, created_at FROM feedback WHERE user_id = ?', u.id),
      reports: db.all('SELECT article_id, message, status, created_at FROM error_reports WHERE user_id = ?', u.id),
      subscriptions: db.all('SELECT status, provider, current_period_end, created_at FROM subscriptions WHERE user_id = ?', u.id),
    };
  });
  app.delete('/me', async (req, reply) => {
    const u = requireUser(req);
    z.strictObject({ confirm: z.literal('EXCLUIR') }).parse(req.body);
    // Contas da equipe têm trilha editorial vinculada (auditoria); exclusão passa pelo admin.
    if (u.role !== 'reader') throw new AppError(409, 'staff_account', 'Contas da equipe editorial são encerradas pelo administrador.');
    db.tx(() => {
      revokeAllSessions(db, u.id);
      db.run('UPDATE error_reports SET user_id = NULL WHERE user_id = ?', u.id);
      db.run('DELETE FROM auth_challenges WHERE email = ?', u.email);
      db.run('DELETE FROM users WHERE id = ?', u.id); // cascata: sessões, preferências, eventos, salvos, assinaturas
      audit(db, null, 'user.deleted', 'user', u.id);
    });
    setSessionCookie(reply, cfg, null);
    return { ok: true };
  });
}
