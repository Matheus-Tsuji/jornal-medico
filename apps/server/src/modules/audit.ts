import type { Db } from '../db/index.ts';
import { id, nowIso } from '../lib/util.ts';

/** Trilha de auditoria: ator, ação, alvo. Sem dados pessoais além do necessário. */
export function audit(db: Db, actorId: string | null, action: string, targetType: string | null, targetId: string | null, detail: Record<string, unknown> = {}) {
  db.run(
    'INSERT INTO audit_events (id, actor_id, action, target_type, target_id, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    id(), actorId, action, targetType, targetId, JSON.stringify(detail), nowIso(),
  );
}

/** Flags com implementação real. As demais não podem ser ligadas (Regra 8), nem pela API nem pelo seed. */
export const IMPLEMENTED_FLAGS = ['real_content', 'ai_preview'];

export function flag(db: Db, key: string): boolean {
  return db.get<{ enabled: number }>('SELECT enabled FROM feature_flags WHERE key = ?', key)?.enabled === 1;
}

export function allFlags(db: Db): Record<string, boolean> {
  return Object.fromEntries(db.all<{ key: string; enabled: number }>('SELECT key, enabled FROM feature_flags').map((r) => [r.key, r.enabled === 1]));
}
