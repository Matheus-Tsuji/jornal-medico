// Montagem do servidor HTTP (Fastify). Segurança: cabeçalhos/CSP, rate limit, cookie HttpOnly,
// defesa CSRF por cabeçalho customizado + SameSite, erros sem stack trace.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ZodError } from 'zod';
import type { Config } from '../config.ts';
import { REPO_ROOT, type Db } from '../db/index.ts';
import { AppError } from '../lib/util.ts';
import { userFromToken, type SessionUser } from '../modules/auth.ts';
import { publicRoutes } from './routes-public.ts';
import { userRoutes } from './routes-user.ts';
import { adminRoutes } from './routes-admin.ts';
import { billingRoutes } from './routes-billing.ts';
import { openapi } from './openapi.ts';

declare module 'fastify' {
  interface FastifyRequest { user: SessionUser | null }
}

export const SESSION_COOKIE = 'jm_session';

export interface Ctx { db: Db; cfg: Config }

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new AppError(401, 'unauthenticated', 'Entre com seu e-mail para continuar.');
  return req.user;
}
export function requireRole(req: FastifyRequest, ...roles: SessionUser['role'][]): SessionUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw new AppError(403, 'forbidden', 'Você não tem permissão para esta ação.');
  return u;
}
export function setSessionCookie(reply: FastifyReply, cfg: Config, token: string | null) {
  if (token === null) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return;
  }
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: cfg.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: cfg.SESSION_DAYS * 86_400,
  });
}

export async function buildApp(ctx: Ctx): Promise<FastifyInstance> {
  const { db, cfg } = ctx;
  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: cfg.NODE_ENV === 'production',
    bodyLimit: 256 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: cfg.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  // Só a API conta: páginas e arquivos estáticos (JS, CSS, fontes) não gastam a cota do leitor.
  await app.register(rateLimit, { max: cfg.NODE_ENV === 'test' ? 10_000 : 300, timeWindow: '1 minute', allowList: (req) => !req.url.startsWith('/api/') });

  app.addHook('onRequest', async (req, reply) => {
    req.user = userFromToken(db, req.cookies[SESSION_COOKIE], cfg);
    reply.header('x-request-id', req.id);
    // CSRF: mutações exigem cabeçalho customizado (navegadores não o enviam cross-site sem preflight/CORS).
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating && req.url.startsWith('/api/') && !req.url.startsWith('/api/v1/billing/webhook/') && req.headers['x-requested-with'] !== 'jornal-medico') {
      throw new AppError(403, 'csrf', 'Requisição bloqueada (proteção CSRF).');
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', req.user ? 'private, no-store' : reply.getHeader('cache-control') ?? 'no-store');
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ code: err.code, message: err.message, requestId: req.id });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ code: 'validation_error', message: first ? `${first.path.join('.') || 'entrada'}: ${first.message}` : 'Entrada inválida.', requestId: req.id });
    }
    if (err.statusCode === 429) return reply.status(429).send({ code: 'rate_limited', message: 'Muitas requisições. Aguarde um pouco.', requestId: req.id });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ code: 'bad_request', message: 'Requisição inválida.', requestId: req.id });
    req.log.error({ err: { message: err.message, name: err.name } }, 'unhandled_error');
    return reply.status(500).send({ code: 'internal_error', message: 'Erro interno. Tente novamente.', requestId: req.id });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_req, reply) => {
    try {
      db.get('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  // Coleta de rotas para o documento OpenAPI.
  const routes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (r) => {
    if (r.url.startsWith('/api/v1')) for (const m of [r.method].flat()) if (m !== 'HEAD') routes.push({ method: m.toLowerCase(), url: r.url });
  });
  app.get('/api/v1/openapi.json', async () => openapi(routes, cfg.BRAND_NAME));

  await app.register(async (api) => {
    await publicRoutes(api, ctx);
    await userRoutes(api, ctx);
    await billingRoutes(api, ctx);
    await adminRoutes(api, ctx);
  }, { prefix: '/api/v1' });

  // Front-end compilado (produção/e2e): SPA servida pelo mesmo processo.
  const dist = resolve(REPO_ROOT, cfg.WEB_DIST ?? 'apps/web/dist');
  if (existsSync(join(dist, 'index.html'))) {
    // wildcard (padrão): arquivos são resolvidos a cada requisição, então um build novo vale sem reiniciar.
    await app.register(fastifyStatic, {
      root: dist,
      setHeaders: (res, path) => {
        // arquivos com hash no nome podem ficar em cache para sempre; o resto é revalidado
        res.header('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ code: 'not_found', message: 'Rota não encontrada.', requestId: req.id });
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.status(404).send({ code: 'not_found', message: 'Rota não encontrada.', requestId: req.id }));
  }
  return app;
}
