// Assinatura provider-agnostic. Só o provedor 'sandbox' existe no MVP: nenhuma cobrança real.
// O estado da assinatura muda SOMENTE via webhook assinado (nunca pelo retorno do checkout).
import { billingEventSchema, type BillingEvent, type Plan, type SubscriptionDto } from '@jm/contracts';
import type { Config } from '../config.ts';
import type { Db, Row } from '../db/index.ts';
import { AppError, addDays, hmac, id, nowIso, safeEqual } from '../lib/util.ts';
import { audit } from './audit.ts';

const planDto = (r: Row): Plan => ({
  id: r.id as string, slug: r.slug as string, name: r.name as string, priceCents: r.price_cents as number,
  currency: 'BRL', interval: r.interval as Plan['interval'], active: r.active === 1, description: r.description as string,
});

export const listPlans = (db: Db, includeInactive = false) =>
  db.all(`SELECT * FROM plans ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY price_cents`).map(planDto);

function currentSub(db: Db, userId: string): Row | undefined {
  return db.get(
    `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 WHEN 'incomplete' THEN 3 ELSE 4 END, updated_at DESC LIMIT 1`,
    userId,
  );
}

export function isEntitledSub(sub: Row | undefined, cfg: Config, now = Date.now()): boolean {
  if (!sub) return false;
  const end = sub.current_period_end ? Date.parse(sub.current_period_end as string) : 0;
  if (sub.status === 'active' || sub.status === 'trialing') return end > now;
  if (sub.status === 'past_due') return end + cfg.BILLING_GRACE_DAYS * 86_400_000 > now;
  return false;
}

export function entitled(db: Db, cfg: Config, user: { id: string; role: string } | null): boolean {
  if (!cfg.PAYWALL_ENABLED) return true;
  if (!user) return false;
  if (user.role !== 'reader') return true;
  return isEntitledSub(currentSub(db, user.id), cfg);
}

export function subscriptionDto(db: Db, cfg: Config, userId: string): SubscriptionDto {
  const sub = currentSub(db, userId);
  const plan = sub ? db.get('SELECT * FROM plans WHERE id = ?', sub.plan_id as string) : undefined;
  return {
    status: (sub?.status as SubscriptionDto['status']) ?? 'none',
    plan: plan ? planDto(plan) : null,
    currentPeriodEnd: (sub?.current_period_end as string) ?? null,
    cancelAtPeriodEnd: sub?.cancel_at_period_end === 1,
    provider: (sub?.provider as string) ?? null,
    entitled: isEntitledSub(sub, cfg) || !cfg.PAYWALL_ENABLED,
  };
}

/** Assinaturas cujo período (ou carência) já acabou passam a 'canceled': liberam nova contratação. */
export function expireSubscriptions(db: Db, cfg: Config, userId: string, now = Date.now()) {
  const nowS = new Date(now).toISOString();
  const graceS = new Date(now - cfg.BILLING_GRACE_DAYS * 86_400_000).toISOString();
  db.run(
    `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE user_id = ? AND (
       (status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end <= ?)) OR
       (status = 'past_due' AND (current_period_end IS NULL OR current_period_end <= ?)))`,
    nowS, userId, nowS, graceS,
  );
}

export function checkout(db: Db, cfg: Config, userId: string, planId: string): { url: string; externalId: string } {
  const plan = db.get('SELECT * FROM plans WHERE id = ? AND active = 1', planId);
  if (!plan) throw new AppError(404, 'plan_not_found', 'Plano indisponível.');
  expireSubscriptions(db, cfg, userId);
  const existing = db.get("SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing','past_due')", userId);
  if (existing) throw new AppError(409, 'already_subscribed', 'Você já tem uma assinatura ativa.');
  const externalId = `sbx_sub_${id()}`;
  db.tx(() => {
    db.run("UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE user_id = ? AND status = 'incomplete'", nowIso(), userId);
    db.run(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, provider, external_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      id(), userId, planId, 'incomplete', 'sandbox', externalId, nowIso(), nowIso(),
    );
  });
  audit(db, userId, 'billing.checkout_started', 'plan', planId, { provider: 'sandbox' });
  return { url: `/assinatura/sandbox?sub=${encodeURIComponent(externalId)}`, externalId };
}


export const signPayload = (secret: string, raw: string) => `sha256=${hmac(secret, raw)}`;

/** Processa webhook: verifica assinatura sobre o corpo bruto e aplica idempotência por ID do evento. */
export function handleWebhook(db: Db, cfg: Config, provider: string, raw: string, signature: string | undefined): { duplicate: boolean } {
  if (provider !== cfg.PAYMENT_PROVIDER || !cfg.PAYMENT_WEBHOOK_SECRET) throw new AppError(404, 'unknown_provider', 'Provedor desconhecido.');
  if (!signature || !safeEqual(signature, signPayload(cfg.PAYMENT_WEBHOOK_SECRET, raw))) {
    throw new AppError(401, 'invalid_signature', 'Assinatura do webhook inválida.');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'invalid_payload', 'Payload inválido.');
  }
  // Schema estrito: tipo fora da lista (inclusive "constructor") e data não ISO viram 400, nunca 500.
  const parsed = billingEventSchema.safeParse(json);
  if (!parsed.success) throw new AppError(400, 'invalid_payload', 'Payload inválido.');
  const ev = parsed.data;
  return db.tx(() => {
    const ins = db.run(
      'INSERT OR IGNORE INTO billing_events (id, provider, external_event_id, type, payload, received_at) VALUES (?,?,?,?,?,?)',
      id(), provider, ev.id, ev.type, raw, nowIso(),
    );
    if (Number(ins.changes) === 0) return { duplicate: true };
    const sub = db.get('SELECT * FROM subscriptions WHERE external_id = ? AND provider = ?', ev.data.subscriptionId, provider);
    if (!sub) throw new AppError(404, 'subscription_not_found', 'Assinatura não encontrada.');
    const end = ev.data.currentPeriodEnd ?? addDays(nowIso(), 30);
    const next: Record<BillingEvent['type'], [string, string | null]> = {
      'subscription.activated': ['active', end],
      'subscription.renewed': ['active', end],
      'payment.failed': ['past_due', (sub.current_period_end as string) ?? nowIso()],
      'subscription.canceled': ['canceled', (sub.current_period_end as string) ?? null],
    };
    const [status, periodEnd] = next[ev.type];
    if (status === 'active' && db.get("SELECT 1 FROM subscriptions WHERE user_id = ? AND id <> ? AND status IN ('active','trialing','past_due')", sub.user_id as string, sub.id as string)) {
      throw new AppError(409, 'already_subscribed', 'O usuário já tem outra assinatura ativa.');
    }
    db.run('UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE id = ?', status, periodEnd, nowIso(), sub.id as string);
    db.run('UPDATE billing_events SET processed_at = ? WHERE provider = ? AND external_event_id = ?', nowIso(), provider, ev.id);
    audit(db, null, `billing.${ev.type}`, 'subscription', sub.id as string, { status });
    return { duplicate: false };
  });
}

/** Simula o provedor sandbox: gera um evento assinado e passa pelo mesmo caminho do webhook. */
export function sandboxComplete(db: Db, cfg: Config, userId: string, externalId: string, outcome: 'approved' | 'failed') {
  // Sandbox ativa assinatura sem pagamento: nunca em produção.
  if (cfg.PAYMENT_PROVIDER !== 'sandbox' || cfg.NODE_ENV === 'production') throw new AppError(404, 'not_found', 'Indisponível.');
  const sub = db.get('SELECT * FROM subscriptions WHERE external_id = ? AND user_id = ?', externalId, userId);
  if (!sub) throw new AppError(404, 'not_found', 'Assinatura não encontrada.'); // inclui acesso cruzado
  if (sub.status !== 'incomplete') throw new AppError(409, 'checkout_closed', 'Este checkout não está mais aberto. Comece um novo.');
  const ev: BillingEvent = {
    id: `sbx_evt_${id()}`,
    type: outcome === 'approved' ? 'subscription.activated' : 'payment.failed',
    data: { subscriptionId: externalId, currentPeriodEnd: addDays(nowIso(), 30) },
  };
  const raw = JSON.stringify(ev);
  return handleWebhook(db, cfg, 'sandbox', raw, signPayload(cfg.PAYMENT_WEBHOOK_SECRET!, raw));
}

export function cancel(db: Db, userId: string) {
  const r = db.run("UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE user_id = ? AND status IN ('active','trialing','past_due')", nowIso(), userId);
  if (Number(r.changes) === 0) throw new AppError(404, 'no_subscription', 'Nenhuma assinatura ativa.');
  audit(db, userId, 'billing.cancel_requested', 'user', userId);
}
