// Fila durável em SQLite: idempotência por chave única, claim atômico com lease,
// recuperação de workers interrompidos, backoff exponencial com jitter.
import { z } from 'zod';
import type { Db, Params, Row } from '../db/index.ts';
import { id, nowIso } from '../lib/util.ts';

export type JobType = 'discover' | 'analyze' | 'compose' | 'recheck' | 'monitor';
export interface Job { id: string; type: JobType; payload: Record<string, unknown>; attempts: number; max_attempts: number; idempotency_key: string; token: string; invalid?: string }

/** Ordem da fila (maior primeiro). Coleta antes de análise; entre análises, o que tende a ser evidência forte. */
export const PRIORITY = { collect: 50, metaAnalysis: 30, trial: 20, other: 10 } as const;
export function analyzePriority(publicationTypes: string[]): number {
  const has = (re: RegExp) => publicationTypes.some((t) => re.test(t));
  if (has(/Meta-Analysis|Systematic Review/)) return PRIORITY.metaAnalysis;
  if (has(/Randomized Controlled Trial|Guideline|Phase III/)) return PRIORITY.trial;
  return PRIORITY.other;
}

export function enqueue(db: Db, type: JobType, key: string, payload: Record<string, unknown> = {}, opts: { runAt?: string; maxAttempts?: number; priority?: number } = {}): { id: string; created: boolean } {
  const jid = id();
  const r = db.run(
    `INSERT OR IGNORE INTO jobs (id, type, idempotency_key, payload, status, max_attempts, next_run_at, priority, created_at, updated_at)
     VALUES (?,?,?,?, 'queued', ?, ?, ?, ?, ?)`,
    jid, type, key, JSON.stringify(payload), opts.maxAttempts ?? 5, opts.runAt ?? nowIso(), opts.priority ?? (type === 'analyze' ? PRIORITY.other : PRIORITY.collect), nowIso(), nowIso(),
  );
  if (Number(r.changes) === 1) return { id: jid, created: true };
  return { id: db.get<{ id: string }>('SELECT id FROM jobs WHERE idempotency_key = ?', key)!.id, created: false };
}

export const LEASE_MS = 5 * 60_000;

/** Payload esperado por tipo de job. Payload que não confere vira falha do job, não queda do ciclo. */
const payloadSchemas: Record<JobType, z.ZodType<Record<string, unknown>>> = {
  discover: z.object({ topic: z.string().min(1), source: z.string().optional() }),
  analyze: z.object({ articleId: z.string().min(1) }),
  compose: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  recheck: z.object({}),
  monitor: z.object({ source: z.string().min(1) }),
};

/**
 * Pega o próximo job. `token` identifica esta posse: todas as transições exigem o mesmo token, então um worker cujo
 * lease venceu (e o job foi retomado por outro) não sobrescreve o resultado de ninguém.
 */
export function claim(db: Db, workerId: string, leaseMs = LEASE_MS): Job | null {
  const now = nowIso();
  // Lease vencido sem tentativas restantes: falha de vez em vez de voltar em loop (job que derruba a função).
  db.run(
    "UPDATE jobs SET status = 'failed', lease_until = NULL, last_error = 'Lease expirado depois do máximo de tentativas (o processo morreu durante o job).', updated_at = ? WHERE status = 'running' AND lease_until < ? AND attempts >= max_attempts",
    now, now,
  );
  const token = `${workerId}:${id()}`;
  const row = db.get<Row>(
    `UPDATE jobs SET status = 'running', locked_by = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = (SELECT id FROM jobs
                   WHERE (status IN ('queued','retry') AND next_run_at <= ?)
                      OR (status = 'running' AND lease_until < ? AND attempts < max_attempts)
                   ORDER BY priority DESC, next_run_at LIMIT 1)
      RETURNING id, type, payload, attempts, max_attempts, idempotency_key`,
    token, new Date(Date.now() + leaseMs).toISOString(), now, now, now,
  );
  if (!row) return null;
  const base = { id: row.id as string, type: row.type as JobType, attempts: row.attempts as number, max_attempts: row.max_attempts as number, idempotency_key: row.idempotency_key as string, token };
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload as string);
  } catch {
    return { ...base, payload: {}, invalid: 'Payload do job não é JSON válido.' };
  }
  const parsed = payloadSchemas[base.type]?.safeParse(raw);
  if (!parsed?.success) return { ...base, payload: {}, invalid: `Payload inválido para job '${base.type}'.` };
  return { ...base, payload: parsed.data };
}

/** Transição de estado condicionada à posse (id + token). Devolve false se o job já não é deste worker. */
const own = (db: Db, job: Job, set: string, ...params: Params) =>
  Number(db.run(`UPDATE jobs SET ${set} WHERE id = ? AND locked_by = ? AND status = 'running'`, ...params, job.id, job.token).changes) === 1;

/** Renova o lease durante execuções longas. */
export const heartbeat = (db: Db, job: Job, leaseMs = LEASE_MS) => own(db, job, 'lease_until = ?, updated_at = ?', new Date(Date.now() + leaseMs).toISOString(), nowIso());

export function complete(db: Db, job: Job, result: unknown = null) {
  return own(db, job, "status = 'completed', lease_until = NULL, result = ?, last_error = NULL, updated_at = ?", JSON.stringify(result ?? null), nowIso());
}

/** Falha transitória: reagenda com backoff (ou Retry-After); esgota tentativas → failed. */
export function retryLater(db: Db, job: Job, error: string, retryAfterMs?: number, rand = Math.random) {
  if (job.attempts >= job.max_attempts) return fail(db, job, error);
  const base = Math.min(60 * 60_000, 2 ** job.attempts * 30_000);
  const delay = Math.max(retryAfterMs ?? 0, base / 2 + rand() * (base / 2));
  return own(db, job, "status = 'retry', lease_until = NULL, last_error = ?, next_run_at = ?, updated_at = ?", sanitize(error), new Date(Date.now() + delay).toISOString(), nowIso());
}

export function fail(db: Db, job: Job, error: string) {
  return own(db, job, "status = 'failed', lease_until = NULL, last_error = ?, updated_at = ?", sanitize(error), nowIso());
}

/** Análises que esperam vaga há mais de `maxAgeDays` saem da fila (com motivo; reenfileiráveis no painel),
 *  para a fila não virar passivo eterno quando o volume diário passa da cota de IA. */
export function expireStaleAnalyses(db: Db, maxAgeDays: number): number {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  return Number(db.run(
    "UPDATE jobs SET status = 'blocked', lease_until = NULL, last_error = ?, updated_at = ? WHERE type = 'analyze' AND status IN ('queued','retry') AND created_at < ?",
    `Expirado: ${maxAgeDays} dias na fila sem vaga de análise. Reenfileire em /admin/jobs se ainda interessar.`, nowIso(), cutoff,
  ).changes);
}

/** Adiado: condição passageira que se resolve sozinha (orçamento do dia esgotado, IA ainda não configurada).
 *  Volta para a fila sem gastar tentativa, para o ciclo diário retomar sem ninguém intervir. */
export function defer(db: Db, job: Job, reason: string, delayMs: number) {
  return own(db, job, "status = 'retry', attempts = MAX(attempts - 1, 0), lease_until = NULL, last_error = ?, next_run_at = ?, updated_at = ?", sanitize(reason), new Date(Date.now() + delayMs).toISOString(), nowIso());
}

/** Bloqueado: precisa de ação humana/configuração (licença, artigo sem abstract, tabela de preços incompleta). */
export function block(db: Db, job: Job, reason: string) {
  return own(db, job, "status = 'blocked', lease_until = NULL, last_error = ?, updated_at = ?", sanitize(reason), nowIso());
}

/** Reprocessamento manual (restrito ao admin). */
export function requeue(db: Db, jobId: string) {
  return db.run("UPDATE jobs SET status = 'queued', attempts = 0, next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status IN ('failed','blocked')", nowIso(), nowIso(), jobId);
}

// Remove possíveis segredos de mensagens de erro antes de gravar.
export const sanitize = (s: string) => s.replace(/(api[_-]?key|authorization)\s*[=:]\s*\S+/gi, '$1=[redacted]').replace(/bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]').slice(0, 1000);
