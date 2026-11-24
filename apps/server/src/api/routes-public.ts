// Rotas públicas (sessão opcional): config, catálogo, edições, acervo, rankings, autenticação.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { articleListQuery, passwordAuthInput, passwordRegisterInput, requestCodeInput, verifyCodeInput, type ArticleCard, type PublicConfig, type Source, type Topic } from '@jm/contracts';
import type { Params } from '../db/index.ts';
import { AppError, localDate } from '../lib/util.ts';
import { allFlags, flag } from '../modules/audit.ts';
import { createGuest, loginWithPassword, registerWithPassword, requestCode, revokeAllSessions, revokeSession, verifyCode } from '../modules/auth.ts';
import { listMonitor } from '../modules/monitor.ts';
import { entitled } from '../modules/billing.ts';
import { articleDetail, cardMap, cards, editionDto, editionList, oneVisiblePerArticle, previewEdition, publishedEdition, visibility } from '../modules/content.ts';
import { loadProfile, recommend } from '../modules/ranking.ts';
import { requireUser, setSessionCookie, type Ctx } from './app.ts';

export async function publicRoutes(app: FastifyInstance, { db, cfg }: Ctx) {
  // Caixa postal de dev: exige ambiente de desenvolvimento/teste E a flag explícita DEV_OUTBOX.
  const devOutbox = () => (cfg.NODE_ENV === 'development' || cfg.NODE_ENV === 'test') && cfg.DEV_OUTBOX && cfg.AUTH_EMAIL_PROVIDER === 'console';
  app.get('/config', async (): Promise<PublicConfig> => {
    const flags = allFlags(db);
    return {
      brandName: cfg.BRAND_NAME,
      realContent: !!flags.real_content,
      paywall: cfg.PAYWALL_ENABLED,
      paymentProvider: cfg.PAYMENT_PROVIDER,
      devOutbox: devOutbox(),
      emailLogin: cfg.emailLogin,
      ephemeral: !!cfg.ephemeral,
      features: flags,
      editionHour: cfg.EDITION_HOUR,
      timezone: cfg.APP_TIMEZONE,
    };
  });

  app.get('/monitor', async (req) => {
    const { kind } = z.object({ kind: z.enum(['regulation', 'publication']).default('regulation') }).parse(req.query);
    return listMonitor(db, kind);
  });

  app.get('/topics', async (): Promise<Topic[]> =>
    db.all(
      `SELECT t.id, t.slug, p.slug AS parent_slug, t.level, t.label_pt, t.enabled, COALESCE(t.color, p.color, pp.color) AS color
         FROM topics t LEFT JOIN topics p ON p.id = t.parent_id LEFT JOIN topics pp ON pp.id = p.parent_id ORDER BY t.sort`,
    ).map((r) => ({ id: r.id as string, slug: r.slug as string, parentSlug: (r.parent_slug as string) ?? null, level: r.level as Topic['level'], label: r.label_pt as string, enabled: r.enabled === 1, color: (r.color as string) ?? null })),
  );

  app.get('/sources', async (): Promise<Source[]> =>
    db.all("SELECT * FROM sources WHERE kind <> 'fixture' ORDER BY enabled DESC, name").map((r) => ({
      id: r.id as string, slug: r.slug as string, name: r.name as string, kind: r.kind as string, officialUrl: r.official_url as string, status: r.status as string, enabled: r.enabled === 1,
    })),
  );

  // ---------- Autenticação ----------
  const authLimit = { config: { rateLimit: { max: cfg.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } } };
  app.post('/auth/request-code', authLimit, async (req) => {
    // Produção sem provedor de e-mail: não gera código (ele não teria como chegar e não pode aparecer na tela).
    if (!cfg.emailLogin) throw new AppError(503, 'email_unavailable', 'O acesso por e-mail ainda não está disponível. Use "Continuar sem e-mail".');
    const { email } = requestCodeInput.parse(req.body);
    await requestCode(db, cfg, email, req.ip);
    // Mesma resposta para e-mail novo ou existente.
    return { ok: true, message: 'Se o endereço for válido, você receberá um código em instantes.' };
  });
  app.post('/auth/verify-code', authLimit, async (req, reply) => {
    const { email, code } = verifyCodeInput.parse(req.body);
    const { token } = verifyCode(db, cfg, email, code, req.user?.isGuest ? req.user.id : undefined);
    if (req.user) revokeSession(db, req.user.sessionId); // rotação de sessão ao autenticar
    setSessionCookie(reply, cfg, token);
    const u = db.get<{ onboarded_at: string | null }>('SELECT onboarded_at FROM users WHERE email = ?', email)!;
    return { ok: true, onboarded: !!u.onboarded_at };
  });
  // E-mail e senha: cadastro e entrada (funciona sem provedor de e-mail).
  const passwordAuth = (register: boolean) => async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const { email, password, displayName } = register ? passwordRegisterInput.parse(req.body) : { ...passwordAuthInput.parse(req.body), displayName: undefined };
    const guestId = req.user?.isGuest ? req.user.id : undefined;
    const { token } = register
      ? await registerWithPassword(db, cfg, email.trim().toLowerCase(), password, guestId, displayName)
      : await loginWithPassword(db, cfg, email.trim().toLowerCase(), password, guestId);
    if (req.user) revokeSession(db, req.user.sessionId);
    setSessionCookie(reply, cfg, token);
    const u = db.get<{ onboarded_at: string | null }>('SELECT onboarded_at FROM users WHERE email = ?', email.trim().toLowerCase())!;
    return { ok: true, onboarded: !!u.onboarded_at };
  };
  app.post('/auth/register', authLimit, passwordAuth(true));
  app.post('/auth/login', authLimit, passwordAuth(false));
  // Entrar sem e-mail (visitante). Limite por IP para não encher o banco de contas vazias.
  app.post('/auth/guest', { config: { rateLimit: { max: cfg.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (req.user) return { ok: true, onboarded: !!db.get('SELECT 1 FROM users WHERE id = ? AND onboarded_at IS NOT NULL', req.user.id) };
    const { token } = createGuest(db, cfg);
    setSessionCookie(reply, cfg, token);
    return { ok: true, onboarded: false };
  });
  app.post('/auth/logout', async (req, reply) => {
    if (req.user) revokeSession(db, req.user.sessionId);
    setSessionCookie(reply, cfg, null);
    return { ok: true };
  });
  app.post('/auth/logout-all', async (req, reply) => {
    const u = requireUser(req);
    revokeAllSessions(db, u.id);
    setSessionCookie(reply, cfg, null);
    return { ok: true };
  });

  // ---------- Edições ----------
  const withForYou = async (dto: ReturnType<typeof editionDto>, userId: string | null) => {
    // "Para você" = só o que bate com os interesses de quem segue temas (sem completar com itens aleatórios).
    // Sem interesses (ou sem login), vira a seleção geral do sistema, rotulada como tal.
    const { ranked } = await recommend(db, cfg, userId, 40);
    const follows = userId ? loadProfile(db, userId).topics.length > 0 : false;
    const picked = follows ? ranked.filter((r) => r.reasons.some((x) => x.startsWith('Você segue'))) : ranked;
    const m = cardMap(db, picked.map((r) => r.id), userId);
    dto.forYou = picked
      .flatMap((r): ArticleCard[] => { const c = m.get(r.id); return c ? [{ ...c, reasons: r.reasons }] : []; })
      .slice(0, 10);
    return dto;
  };
  app.get('/editions/latest', async (req) => {
    const e = publishedEdition(db);
    const today = localDate(cfg.APP_TIMEZONE);
    // Prévia de IA ligada e sem edição revisada de hoje: mostra a prévia (rotulada) em vez de uma edição antiga.
    if (flag(db, 'real_content') && flag(db, 'ai_preview') && (!e || e.edition_date !== today)) {
      const p = previewEdition(db, req.user?.id ?? null, today);
      if (p) return { edition: await withForYou(p, req.user?.id ?? null) };
    }
    if (!e) return { edition: null };
    return { edition: await withForYou(editionDto(db, e, req.user?.id), req.user?.id ?? null) };
  });
  app.get('/editions', async () => ({ items: editionList(db) }));
  app.get('/editions/:date', async (req) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.params);
    const e = publishedEdition(db, date);
    if (!e) throw new AppError(404, 'edition_not_found', 'Não há edição publicada nesta data.');
    return { edition: editionDto(db, e, req.user?.id) };
  });

  // ---------- Acervo ----------
  app.get('/articles', async (req) => {
    const q = articleListQuery.parse(req.query);
    const v = visibility(db);
    const one = oneVisiblePerArticle(db);
    const where: string[] = [v.sql, one.sql];
    const params: Params = [...v.params, ...one.params];
    if (q.topic) {
      where.push(`ar.id IN (SELECT at.article_id FROM article_topics at WHERE at.topic_id IN (
        WITH RECURSIVE sub(id) AS (SELECT id FROM topics WHERE slug = ?
          UNION SELECT t.id FROM topics t, sub WHERE t.parent_id = sub.id OR EXISTS (SELECT 1 FROM json_each(t.extra_parents) j WHERE j.value = sub.id))
        SELECT id FROM sub))`);
      params.push(q.topic);
    }
    if (q.design) { where.push("json_extract(a.payload, '$.studyDesign') = ?"); params.push(q.design); }
    if (q.source) { where.push('s.slug = ?'); params.push(q.source); }
    if (q.days) { where.push('ar.pub_date >= ?'); params.push(new Date(Date.now() - q.days * 86_400_000).toISOString().slice(0, 10)); }
    if (q.q) {
      where.push("(ar.original_title LIKE ? ESCAPE '\\' OR json_extract(a.payload, '$.editorialHeadline') LIKE ? ESCAPE '\\')");
      const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like);
    }
    // Cursor estável (keyset): chave de ordenação + id.
    const key = q.sort === 'priority' ? 'a.editorial_priority' : "COALESCE(ar.pub_date, '')";
    if (q.cursor) {
      const [k, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      where.push(`(${key}, a.id) < (?, ?)`);
      params.push(q.sort === 'priority' ? Number(k) : k ?? '', id ?? '');
    }
    const rows = db.all<{ aid: string; k: string | number }>(
      `SELECT a.id AS aid, ${key} AS k FROM analyses a JOIN articles ar ON ar.id = a.article_id JOIN sources s ON s.id = ar.source_id
        WHERE ${where.join(' AND ')} ORDER BY ${key} DESC, a.id DESC LIMIT ?`,
      ...params, q.limit + 1,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: cards(db, page.map((r) => r.aid), req.user?.id),
      nextCursor: rows.length > q.limit && last ? Buffer.from(`${last.k}|${last.aid}`).toString('base64url') : null,
    };
  });

  app.get('/articles/:slug', async (req) => {
    const { slug } = z.object({ slug: z.string().max(200) }).parse(req.params);
    const u = req.user;
    return articleDetail(db, slug, { userId: u?.id, entitled: entitled(db, cfg, u), staff: !!u && u.role !== 'reader' });
  });

  app.get('/recommendations', async (req) => {
    const { ranked, engine } = await recommend(db, cfg, req.user?.id ?? null, 10);
    const m = cardMap(db, ranked.map((r) => r.id), req.user?.id);
    return { engine, items: ranked.flatMap((r) => { const c = m.get(r.id); return c ? [{ ...c, reasons: r.reasons }] : []; }) };
  });

  app.get('/rankings/monthly', async (req) => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    // Leitores únicos por artigo (eventos 'open' deduplicados por dia), mínimo configurável para não expor pouca gente.
    const rows = db.all<{ article_id: string; readers: number }>(
      `SELECT article_id, COUNT(DISTINCT user_id) AS readers FROM read_events WHERE kind = 'open' AND created_at >= ?
        GROUP BY article_id HAVING readers >= ? ORDER BY readers DESC LIMIT 10`,
      monthStart.toISOString(), cfg.RANKING_MIN_READERS,
    );
    const v = visibility(db);
    const ids = rows.flatMap((r) => {
      const a = db.get<{ id: string }>(`SELECT a.id FROM analyses a WHERE ${v.sql} AND a.article_id = ? ORDER BY CASE a.status WHEN 'published' THEN 0 ELSE 1 END, a.version DESC LIMIT 1`, ...v.params, r.article_id);
      return a ? [{ aid: a.id, readers: r.readers }] : [];
    });
    const m = cardMap(db, ids.map((x) => x.aid), req.user?.id);
    return {
      criterion: `Leitores únicos no mês (aberturas deduplicadas por dia), mínimo de ${cfg.RANKING_MIN_READERS} leitores. Popularidade não indica validade científica.`,
      month: monthStart.toISOString().slice(0, 7),
      items: ids.flatMap((x) => { const c = m.get(x.aid); return c ? [{ ...c, readers: x.readers }] : []; }),
    };
  });

  // Caixa postal local de desenvolvimento (bloqueada em produção e com provedor real).
  app.get('/dev/outbox', async (req) => {
    if (!devOutbox()) throw new AppError(404, 'not_found', 'Rota não encontrada.');
    const { email } = z.object({ email: z.string().max(254).optional() }).parse(req.query);
    return {
      notice: 'Caixa postal de DESENVOLVIMENTO. Em produção os e-mails saem pelo provedor transacional.',
      items: email
        ? db.all('SELECT to_email, subject, body, created_at FROM dev_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 10', email.toLowerCase())
        : db.all('SELECT to_email, subject, body, created_at FROM dev_outbox ORDER BY created_at DESC LIMIT 20'),
    };
  });
}
