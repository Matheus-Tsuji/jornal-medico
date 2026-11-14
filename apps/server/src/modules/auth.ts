// Login sem senha por código de 6 dígitos.
// - Código guardado só como HMAC(segredo do servidor, email:código): vazamento do banco não permite
//   força bruta offline sem o segredo.
// - Uso único, 10 min de validade, 5 tentativas por desafio, limite de envios por e-mail e por IP.
// - Respostas idênticas existindo ou não a conta (sem enumeração).
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { AppError, hmac, id, nowIso, randomToken, sha256, sixDigitCode, addDays, safeEqual } from '../lib/util.ts';
import { safeFetch } from '../lib/net.ts';
import { audit } from './audit.ts';

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_EMAIL_HOUR = 5;
const MAX_CODES_PER_IP_HOUR = 20;
const RESEND_COOLDOWN_S = 30;

export async function requestCode(db: Db, cfg: Config, email: string, ip: string, send = sendMail): Promise<void> {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const perEmail = db.get<{ n: number; last: string | null }>(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM auth_challenges WHERE email = ? AND created_at > ?', email, hourAgo,
  )!;
  const perIp = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_challenges WHERE ip = ? AND created_at > ?', ip, hourAgo)!;
  if (perEmail.n >= MAX_CODES_PER_EMAIL_HOUR || perIp.n >= MAX_CODES_PER_IP_HOUR) {
    throw new AppError(429, 'rate_limited', 'Muitas solicitações. Aguarde alguns minutos e tente de novo.');
  }
  if (perEmail.last && Date.now() - Date.parse(perEmail.last) < RESEND_COOLDOWN_S * 1000) {
    throw new AppError(429, 'resend_cooldown', `Aguarde ${RESEND_COOLDOWN_S} segundos para pedir um novo código.`);
  }
  const code = sixDigitCode();
  db.tx(() => {
    // Um código novo invalida os anteriores.
    db.run('UPDATE auth_challenges SET used_at = ? WHERE email = ? AND used_at IS NULL', nowIso(), email);
    db.run(
      'INSERT INTO auth_challenges (id, email, code_hash, expires_at, ip, created_at) VALUES (?,?,?,?,?,?)',
      id(), email, hmac(cfg.sessionSecret, `${email}:${code}`), new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(), ip, nowIso(),
    );
  });
  await send(db, cfg, email, `Seu código de acesso: ${code}`,
    `Seu código para entrar no ${cfg.BRAND_NAME} é ${code}.\nEle vale por ${CODE_TTL_MIN} minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`);
}

/** Verifica o código. Se houver sessão de visitante, a conta do visitante é convertida (ou mesclada) — nada se perde. */
export function verifyCode(db: Db, cfg: Config, email: string, code: string, guestUserId?: string): { token: string; userId: string } {
  const ch = db.get<{ id: string; code_hash: string; expires_at: string; attempts: number }>(
    'SELECT id, code_hash, expires_at, attempts FROM auth_challenges WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1', email,
  );
  const invalid = new AppError(400, 'invalid_code', 'Código inválido ou expirado. Peça um novo código.');
  if (!ch) throw invalid;
  if (Date.parse(ch.expires_at) < Date.now() || ch.attempts >= MAX_ATTEMPTS) {
    db.run('UPDATE auth_challenges SET used_at = ? WHERE id = ?', nowIso(), ch.id);
    throw invalid;
  }
  if (!safeEqual(ch.code_hash, hmac(cfg.sessionSecret, `${email}:${code}`))) {
    db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id);
    throw invalid;
  }
  return db.tx(() => {
    // Marca como usado de forma atômica: se outra requisição usou antes, falha.
    const used = db.run('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), ch.id);
    if (Number(used.changes) !== 1) throw invalid;
    let user = db.get<{ id: string; role: string; status: string }>('SELECT id, role, status FROM users WHERE email = ?', email);
    const guest = guestUserId ? db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_guest = 1', guestUserId) : undefined;
    if (guest && !user) {
      // Visitante informa e-mail novo: a própria conta vira conta identificada.
      const role = cfg.adminEmails.has(email) ? 'admin' : 'reader';
      db.run('UPDATE users SET email = ?, is_guest = 0, role = ?, verified_at = ? WHERE id = ?', email, role, nowIso(), guest.id);
      user = { id: guest.id, role, status: 'active' };
      audit(db, guest.id, 'user.guest_upgraded', 'user', guest.id);
    } else if (guest && user) {
      // E-mail já tem conta: leva salvos e leituras; interesses só se a conta não tiver nenhum.
      db.run('INSERT OR IGNORE INTO bookmarks (user_id, article_id, created_at) SELECT ?, article_id, created_at FROM bookmarks WHERE user_id = ?', user.id, guest.id);
      db.run('INSERT OR IGNORE INTO read_events (id, user_id, article_id, kind, day, created_at) SELECT id, ?, article_id, kind, day, created_at FROM read_events WHERE user_id = ?', user.id, guest.id);
      if (!db.get('SELECT 1 FROM user_preferences WHERE user_id = ?', user.id)) db.run('UPDATE user_preferences SET user_id = ? WHERE user_id = ?', user.id, guest.id);
      db.run('DELETE FROM users WHERE id = ?', guest.id);
      audit(db, user.id, 'user.guest_merged', 'user', user.id);
    }
    if (!user) {
      const uid = id();
      const role = cfg.adminEmails.has(email) ? 'admin' : 'reader';
      db.run('INSERT INTO users (id, email, role, verified_at, created_at) VALUES (?,?,?,?,?)', uid, email, role, nowIso(), nowIso());
      user = { id: uid, role, status: 'active' };
      audit(db, uid, 'user.created', 'user', uid, { role });
    } else if (cfg.adminEmails.has(email) && user.role !== 'admin') {
      db.run("UPDATE users SET role = 'admin' WHERE id = ?", user.id);
    }
    if (user.status !== 'active') throw new AppError(403, 'account_disabled', 'Conta desativada. Fale com o suporte.');
    const token = randomToken();
    db.run(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)',
      id(), user.id, sha256(token), nowIso(), addDays(nowIso(), cfg.SESSION_DAYS), nowIso(),
    );
    return { token, userId: user.id };
  });
}

export interface SessionUser { id: string; email: string; role: 'reader' | 'editor' | 'admin'; sessionId: string; isGuest: boolean }

/** Acesso sem e-mail: conta de visitante com sessão própria. O "e-mail" é um marcador .invalid (domínio reservado, nunca recebe envio). */
export function createGuest(db: Db, cfg: Config): { token: string; userId: string } {
  const uid = id();
  const token = randomToken();
  db.tx(() => {
    db.run("INSERT INTO users (id, email, role, is_guest, created_at) VALUES (?, ?, 'reader', 1, ?)", uid, `visitante-${uid}@visitante.invalid`, nowIso());
    db.run('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)', id(), uid, sha256(token), nowIso(), addDays(nowIso(), cfg.SESSION_DAYS), nowIso());
  });
  return { token, userId: uid };
}

export function userFromToken(db: Db, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.get<{ id: string; email: string; role: SessionUser['role']; sid: string; last_seen_at: string | null; is_guest: number }>(
    `SELECT u.id, u.email, u.role, u.is_guest, s.id AS sid, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
    sha256(token), nowIso(),
  );
  if (!row) return null;
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
    db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), row.sid);
  }
  return { id: row.id, email: row.email, role: row.role, sessionId: row.sid, isGuest: row.is_guest === 1 };
}

export const revokeSession = (db: Db, sessionId: string) => db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), sessionId);
export const revokeAllSessions = (db: Db, userId: string) => db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);

/** E-mail transacional. 'console' = caixa postal local de desenvolvimento (bloqueado em produção). */
export async function sendMail(db: Db, cfg: Config, to: string, subject: string, body: string): Promise<void> {
  if (cfg.AUTH_EMAIL_PROVIDER === 'console') {
    db.run('INSERT INTO dev_outbox (id, to_email, subject, body, created_at) VALUES (?,?,?,?,?)', id(), to, subject, body, nowIso());
    return;
  }
  const res = await safeFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.AUTH_EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.AUTH_EMAIL_FROM, to, subject, text: body }),
  });
  if (!res.ok) throw new AppError(502, 'email_failed', 'Não foi possível enviar o e-mail agora. Tente novamente.');
}
