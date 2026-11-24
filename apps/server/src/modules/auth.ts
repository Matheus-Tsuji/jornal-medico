// Login sem senha por código de 6 dígitos.
// - Código guardado só como HMAC(segredo do servidor, email:código): vazamento do banco não permite
//   força bruta offline sem o segredo.
// - Uso único, 10 min de validade, 5 tentativas por desafio, limite de envios por e-mail e por IP.
// - Respostas idênticas existindo ou não a conta (sem enumeração).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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

// Segredo vazio = ensureSecrets não rodou; falhar é melhor que assinar com string vazia.
// Com o segredo guardado no banco (sem SESSION_SECRET no ambiente), um vazamento do banco expõe também o segredo:
// defina SESSION_SECRET no ambiente ao ligar o login por e-mail.
const secretOf = (cfg: Config) => {
  if (!cfg.sessionSecret) throw new Error('Segredo de sessão não inicializado (ensureSecrets).');
  return cfg.sessionSecret;
};

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
      id(), email, hmac(secretOf(cfg), `${email}:${code}`), new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(), ip, nowIso(),
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
  if (!safeEqual(ch.code_hash, hmac(secretOf(cfg), `${email}:${code}`))) {
    db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id);
    throw invalid;
  }
  return db.tx(() => {
    // Marca como usado de forma atômica: se outra requisição usou antes, falha.
    const used = db.run('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), ch.id);
    if (Number(used.changes) !== 1) throw invalid;
    return signIn(db, cfg, email, guestUserId, { verified: true });
  });
}

/** Cria (ou reaproveita) a conta do e-mail, absorve o visitante e abre uma sessão. Chamar dentro de db.tx. */
function signIn(db: Db, cfg: Config, email: string, guestUserId: string | undefined, opts: { verified: boolean; passwordHash?: string; displayName?: string }): { token: string; userId: string } {
    let user = db.get<{ id: string; role: string; status: string }>('SELECT id, role, status FROM users WHERE email = ?', email);
    const guest = guestUserId ? db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_guest = 1', guestUserId) : undefined;
    if (guest && !user) {
      // Visitante informa e-mail novo: a própria conta vira conta identificada.
      const role = opts.verified && cfg.adminEmails.has(email) ? 'admin' : 'reader';
      db.run('UPDATE users SET email = ?, is_guest = 0, role = ?, verified_at = ?, password_hash = COALESCE(?, password_hash), display_name = COALESCE(?, display_name) WHERE id = ?', email, role, opts.verified ? nowIso() : null, opts.passwordHash ?? null, opts.displayName ?? null, guest.id);
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
      const role = opts.verified && cfg.adminEmails.has(email) ? 'admin' : 'reader';
      db.run('INSERT INTO users (id, email, role, verified_at, password_hash, display_name, created_at) VALUES (?,?,?,?,?,?,?)', uid, email, role, opts.verified ? nowIso() : null, opts.passwordHash ?? null, opts.displayName ?? null, nowIso());
      user = { id: uid, role, status: 'active' };
      audit(db, uid, 'user.created', 'user', uid, { role });
    } else if (opts.verified && cfg.adminEmails.has(email) && user.role !== 'admin') {
      db.run("UPDATE users SET role = 'admin' WHERE id = ?", user.id);
    }
    if (user.status !== 'active') throw new AppError(403, 'account_disabled', 'Conta desativada. Fale com o suporte.');
    const token = randomToken();
    db.run(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)',
      id(), user.id, sha256(token), nowIso(), addDays(nowIso(), cfg.SESSION_DAYS), nowIso(),
    );
    return { token, userId: user.id };
}

export interface SessionUser { id: string; email: string; role: 'reader' | 'editor' | 'admin'; sessionId: string; isGuest: boolean }

/** Acesso sem e-mail: conta de visitante com sessão própria. O "e-mail" é um marcador .invalid (domínio reservado, nunca recebe envio). */
// Vitrine (banco efêmero por instância): o token do visitante leva a própria prova, "g1.<uid>.<sid>.<hmac>",
// e qualquer instância que o receba recria o visitante e a sessão localmente. Visitante não tem dado pessoal.
const guestSig = (cfg: Config, uid: string, sid: string) => hmac(secretOf(cfg), `guest:${uid}.${sid}`);
function insertGuest(db: Db, cfg: Config, uid: string, sid: string, token: string) {
  db.run("INSERT OR IGNORE INTO users (id, email, role, is_guest, created_at) VALUES (?, ?, 'reader', 1, ?)", uid, `visitante-${uid}@visitante.invalid`, nowIso());
  db.run('INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)', sid, uid, sha256(token), nowIso(), addDays(nowIso(), cfg.SESSION_DAYS), nowIso());
}

export function createGuest(db: Db, cfg: Config): { token: string; userId: string } {
  const uid = id();
  const sid = id();
  const token = cfg.ephemeral ? `g1.${uid}.${sid}.${guestSig(cfg, uid, sid)}` : randomToken();
  db.tx(() => insertGuest(db, cfg, uid, sid, token));
  return { token, userId: uid };
}

export function userFromToken(db: Db, token: string | undefined, cfg?: Config): SessionUser | null {
  if (!token) return null;
  if (cfg?.ephemeral && token.startsWith('g1.')) {
    const [, uid, sid, sig] = token.split('.');
    if (uid && sid && sig && safeEqual(sig, guestSig(cfg, uid, sid))) insertGuest(db, cfg, uid, sid, token);
  }
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

// ---------- E-mail e senha ----------
// scrypt (N=16384, r=8, p=1) com sal aleatório de 16 bytes; formato "scrypt$<sal hex>$<hash hex>".
// Cadastro com senha não verifica o e-mail, por isso nunca concede papel de admin (só o login por código concede).
const hashPassword = (pw: string) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`;
};
const checkPassword = (pw: string, stored: string | null) => {
  const [kind, salt, hash] = (stored ?? 'scrypt$00$00').split('$');
  const got = scryptSync(pw, Buffer.from(salt ?? '', 'hex'), 64); // calcula sempre, para não revelar pelo tempo se a conta existe
  const want = Buffer.from(hash ?? '', 'hex');
  return kind === 'scrypt' && want.length === got.length && timingSafeEqual(got, want) && !!stored;
};

export function registerWithPassword(db: Db, cfg: Config, email: string, password: string, guestUserId?: string, displayName?: string) {
  if (db.get('SELECT 1 FROM users WHERE email = ? AND is_guest = 0', email)) {
    throw new AppError(409, 'email_taken', 'Já existe uma conta com este e-mail. Use "Entrar".');
  }
  const passwordHash = hashPassword(password);
  return db.tx(() => {
    const r = signIn(db, cfg, email, guestUserId, { verified: false, passwordHash, displayName });
    audit(db, r.userId, 'user.password_registered', 'user', r.userId);
    return r;
  });
}

export function loginWithPassword(db: Db, cfg: Config, email: string, password: string, guestUserId?: string) {
  const u = db.get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE email = ? AND is_guest = 0', email);
  if (!checkPassword(password, u?.password_hash ?? null)) throw new AppError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
  return db.tx(() => signIn(db, cfg, email, guestUserId, { verified: false }));
}
