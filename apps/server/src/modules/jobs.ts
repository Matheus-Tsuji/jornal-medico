// Fila durável em SQLite: idempotência por chave única, claim atômico com lease,
// recuperação de workers interrompidos, backoff exponencial com jitter.
import type { Db, Row } from '../db/index.ts';
import { id, nowIso } from '../lib/util.ts';

export type JobType = 'discover' | 'analyze' | 'compose' | 'recheck' | 'monitor';
export interface Job { id: string; type: JobType; payload: Record<string, unknown>; attempts: number; max_attempts: number; idempotency_key: string }

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

export function claim(db: Db, workerId: string, leaseMs = 5 * 60_000): Job | null {
  const now = nowIso();
  const row = db.get<Row>(
    `UPDATE jobs SET status = 'running', locked_by = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = (SELECT id FROM jobs
                   WHERE (status IN ('queued','retry') AND next_run_at <= ?)
                      OR (status = 'running' AND lease_until < ?)
                   ORDER BY priority DESC, next_run_at LIMIT 1)
      RETURNING id, type, payload, attempts, max_attempts, idempotency_key`,
    workerId, new Date(Date.now() + leaseMs).toISOString(), now, now, now,
  );
  if (!row) return null;
  return { ...(row as unknown as Job), payload: JSON.parse(row.payload as string) };
}

export function complete(db: Db, jobId: string, result: unknown = null) {
  db.run("UPDATE jobs SET status = 'completed', lease_until = NULL, result = ?, last_error = NULL, updated_at = ? WHERE id = ?", JSON.stringify(result), nowIso(), jobId);
}

/** Falha transitória: reagenda com backoff (ou Retry-After); esgota tentativas → failed. */
export function retryLater(db: Db, job: Job, error: string, retryAfterMs?: number, rand = Math.random) {
  if (job.attempts >= job.max_attempts) return fail(db, job.id, error);
  const base = Math.min(60 * 60_000, 2 ** job.attempts * 30_000);
  const delay = Math.max(retryAfterMs ?? 0, base / 2 + rand() * (base / 2));
  db.run(
    "UPDATE jobs SET status = 'retry', lease_until = NULL, last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
    sanitize(error), new Date(Date.now() + delay).toISOString(), nowIso(), job.id,
  );
}

export function fail(db: Db, jobId: string, error: string) {
  db.run("UPDATE jobs SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?", sanitize(error), nowIso(), jobId);
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
  db.run(
    "UPDATE jobs SET status = 'retry', attempts = MAX(attempts - 1, 0), lease_until = NULL, last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
    sanitize(reason), new Date(Date.now() + delayMs).toISOString(), nowIso(), job.id,
  );
}

/** Bloqueado: precisa de ação humana/configuração (licença, artigo sem abstract, tabela de preços incompleta). */
export function block(db: Db, jobId: string, reason: string) {
  db.run("UPDATE jobs SET status = 'blocked', lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?", sanitize(reason), nowIso(), jobId);
}

/** Reprocessamento manual (restrito ao admin). */
export function requeue(db: Db, jobId: string) {
  return db.run("UPDATE jobs SET status = 'queued', attempts = 0, next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status IN ('failed','blocked')", nowIso(), nowIso(), jobId);
}

// Remove possíveis segredos de mensagens de erro antes de gravar.
export const sanitize = (s: string) => s.replace(/(api[_-]?key|authorization)\s*[=:]\s*\S+/gi, '$1=[redacted]').replace(/bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]').slice(0, 1000);
