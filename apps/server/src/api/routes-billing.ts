// Assinatura (sandbox). Webhook recebe corpo bruto para verificar a assinatura HMAC.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkoutInput } from '@jm/contracts';
import { AppError } from '../lib/util.ts';
import { cancel, checkout, handleWebhook, listPlans, sandboxComplete, subscriptionDto } from '../modules/billing.ts';
import { requireUser, type Ctx } from './app.ts';

export async function billingRoutes(app: FastifyInstance, { db, cfg }: Ctx) {
  app.get('/billing/plans', async () => ({ items: listPlans(db), provider: cfg.PAYMENT_PROVIDER, sandbox: cfg.PAYMENT_PROVIDER === 'sandbox' }));
  app.get('/billing/subscription', async (req) => subscriptionDto(db, cfg, requireUser(req).id));
  app.post('/billing/checkout', async (req) => {
    const u = requireUser(req);
    if (u.isGuest) throw new AppError(403, 'guest_needs_email', 'Para assinar, informe seu e-mail (precisamos dele para recibos e para recuperar a conta).');
    const { planId } = checkoutInput.parse(req.body);
    return checkout(db, cfg, u.id, planId);
  });
  app.post('/billing/portal', async (req) => {
    requireUser(req);
    // Sandbox: o "portal" é a própria página de assinatura.
    return { url: '/assinatura' };
  });
  app.post('/billing/cancel', async (req) => {
    cancel(db, requireUser(req).id);
    return subscriptionDto(db, cfg, requireUser(req).id);
  });
  app.post('/billing/sandbox/complete', async (req) => {
    if (cfg.NODE_ENV === 'production') throw new AppError(404, 'not_found', 'Rota não encontrada.');
    const u = requireUser(req);
    const body = z.strictObject({ subscription: z.string().max(100), outcome: z.enum(['approved', 'failed']) }).parse(req.body);
    sandboxComplete(db, cfg, u.id, body.subscription, body.outcome);
    return subscriptionDto(db, cfg, u.id);
  });

  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hook.post('/billing/webhook/:provider', async (req) => {
      const { provider } = z.object({ provider: z.string().max(40) }).parse(req.params);
      const sig = req.headers['x-webhook-signature'];
      return handleWebhook(db, cfg, provider, String(req.body ?? ''), typeof sig === 'string' ? sig : undefined);
    });
  });
}
