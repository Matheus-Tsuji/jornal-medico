// Login sem senha por código de 6 dígitos.
// - Código guardado só como HMAC(segredo do servidor, email:código): vazamento do banco não permite
//   força bruta offline sem o segredo.
// - Uso único, 10 min de validade, 5 tentativas por desafio, limite de envios por e-mail e por IP.
// - Respostas idênticas existindo ou não a conta (sem enumeração).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Role } from '@jm/contracts';
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
const MAX_CODES_PER_EMAIL_DAY = 20;
// Senha: depois de N falhas para o mesmo e-mail (de qualquer IP) na janela, bloqueia até a janela passar.
const MAX_PASSWORD_FAILURES = 10;
const PASSWORD_FAILURE_WINDOW_MIN = 15;
// Sessões da equipe (editor/admin) caem após este tempo sem uso.
export const STAFF_IDLE_DAYS = 7;

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
  const perDay = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_challenges WHERE email = ? AND created_at > ?', email, new Date(Date.now() - 86_400_000).toISOString())!;
  if (perDay.n >= MAX_CODES_PER_EMAIL_DAY) throw new AppError(429, 'rate_limited', 'Limite diário de códigos atingido para este e-mail. Tente amanhã.');
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
  const ch = db.get<{ id: string; code_hash: string; expires_at: string }>(
    'SELECT id, code_hash, expires_at FROM auth_challenges WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1', email,
  );
  const invalid = new AppError(400, 'invalid_code', 'Código inválido ou expirado. Peça um novo código.');
  if (!ch) throw invalid;
  // Conta a tentativa ANTES de comparar, de forma atômica: requisições simultâneas não passam de MAX_ATTEMPTS.
  const counted = db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < ?', ch.id, MAX_ATTEMPTS);
  if (Date.parse(ch.expires_at) < Date.now() || Number(counted.changes) !== 1) {
    db.run('UPDATE auth_challenges SET used_at = ? WHERE id = ?', nowIso(), ch.id);
    throw invalid;
  }
  if (!safeEqual(ch.code_hash, hmac(secretOf(cfg), `${email}:${code}`))) throw invalid;
  return db.tx(() => {
    // Marca como usado de forma atômica: se outra requisição usou antes, falha.
    const used = db.run('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), ch.id);
    if (Number(used.changes) !== 1) throw invalid;
    return signIn(db, cfg, email, guestUserId, { verified: true });
  });
}

/** Cria (ou reaproveita) a conta do e-mail, absorve o visitante e abre uma sessão. Chamar dentro de db.tx. */
function signIn(db: Db, cfg: Config, email: string, guestUserId: string | undefined, opts: { verified: boolean; passwordHash?: string; displayName?: string }): { token: string; userId: string } {
    let user = db.get<{ id: string; role: string; status: string; verified_at: string | null }>('SELECT id, role, status, verified_at FROM users WHERE email = ? AND is_guest = 0', email);
    const guest = guestUserId ? db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND is_guest = 1', guestUserId) : undefined;
    if (guest && !user) {
      // Visitante informa e-mail novo: a própria conta vira conta identificada.
      const role = opts.verified && cfg.adminEmails.has(email) ? 'admin' : 'reader';
      db.run('UPDATE users SET email = ?, is_guest = 0, role = ?, verified_at = ?, password_hash = COALESCE(?, password_hash), display_name = COALESCE(?, display_name) WHERE id = ?', email, role, opts.verified ? nowIso() : null, opts.passwordHash ?? null, opts.displayName ?? null, guest.id);
      user = { id: guest.id, role, status: 'active', verified_at: opts.verified ? nowIso() : null };
      audit(db, guest.id, 'user.guest_upgraded', 'user', guest.id);
    } else if (guest && user) {
      // E-mail já tem conta: leva salvos e leituras; interesses só se a conta não tiver nenhum.
      db.run('INSERT OR IGNORE INTO bookmarks (user_id, article_id, created_at) SELECT ?, article_id, created_at FROM bookmarks WHERE user_id = ?', user.id, guest.id);
      // IDs novos: reaproveitar o id do visitante faria o INSERT OR IGNORE descartar tudo antes da exclusão em cascata.
      for (const r of db.all<{ article_id: string; kind: string; day: string; created_at: string }>('SELECT article_id, kind, day, created_at FROM read_events WHERE user_id = ?', guest.id)) {
        db.run('INSERT OR IGNORE INTO read_events (id, user_id, article_id, kind, day, created_at) VALUES (?,?,?,?,?,?)', id(), user.id, r.article_id, r.kind, r.day, r.created_at);
      }
      if (!db.get('SELECT 1 FROM user_preferences WHERE user_id = ?', user.id)) db.run('UPDATE user_preferences SET user_id = ? WHERE user_id = ?', user.id, guest.id);
      db.run('DELETE FROM users WHERE id = ?', guest.id);
      audit(db, user.id, 'user.guest_merged', 'user', user.id);
    }
    if (!user) {
      const uid = id();
      const role = opts.verified && cfg.adminEmails.has(email) ? 'admin' : 'reader';
      db.run('INSERT INTO users (id, email, role, verified_at, password_hash, display_name, created_at) VALUES (?,?,?,?,?,?,?)', uid, email, role, opts.verified ? nowIso() : null, opts.passwordHash ?? null, opts.displayName ?? null, nowIso());
      user = { id: uid, role, status: 'active', verified_at: opts.verified ? nowIso() : null };
      audit(db, uid, 'user.created', 'user', uid, { role });
    } else if (opts.verified && !user.verified_at) {
      // Primeira comprovação de posse do e-mail: a senha e as sessões anteriores podem ser de quem cadastrou o
      // e-mail alheio sem comprová-lo. Apaga a senha, derruba as sessões e só então concede admin (uma única vez;
      // rebaixamentos manuais posteriores ficam valendo).
      const role = cfg.adminEmails.has(email) ? 'admin' : user.role;
      db.run('UPDATE users SET verified_at = ?, password_hash = NULL, role = ? WHERE id = ?', nowIso(), role, user.id);
      revokeAllSessions(db, user.id);
      audit(db, user.id, 'user.email_verified', 'user', user.id, { role });
      user = { ...user, role, verified_at: nowIso() };
    }
    if (user.status !== 'active') throw new AppError(403, 'account_disabled', 'Conta desativada. Fale com o suporte.');
    const token = randomToken();
    db.run(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)',
      id(), user.id, sha256(token), nowIso(), addDays(nowIso(), cfg.SESSION_DAYS), nowIso(),
    );
    return { token, userId: user.id };
}

export interface SessionUser { id: string; email: string; role: Role; sessionId: string; isGuest: boolean }

/** Acesso sem e-mail: conta de visitante com sessão própria. O "e-mail" é um marcador .invalid (domínio reservado, nunca recebe envio). */
// Vitrine (banco efêmero por instância): o token do visitante leva a própria prova, "g1.<uid>.<sid>.<exp>.<hmac>",
// e qualquer instância que o receba recria o visitante e a sessão localmente. Visitante não tem dado pessoal.
const guestSig = (cfg: Config, uid: string, sid: string, exp: number) => hmac(secretOf(cfg), `guest:${uid}.${sid}.${exp}`);
function insertGuest(db: Db, uid: string, sid: string, token: string, expiresAt: string) {
  db.run("INSERT OR IGNORE INTO users (id, email, role, is_guest, created_at) VALUES (?, ?, 'reader', 1, ?)", uid, `visitante-${uid}@visitante.invalid`, nowIso());
  db.run('INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)', sid, uid, sha256(token), nowIso(), expiresAt, nowIso());
}

export function createGuest(db: Db, cfg: Config): { token: string; userId: string } {
  const uid = id();
  const sid = id();
  const expiresAt = addDays(nowIso(), cfg.SESSION_DAYS);
  const exp = Date.parse(expiresAt);
  const token = cfg.ephemeral ? `g1.${uid}.${sid}.${exp}.${guestSig(cfg, uid, sid, exp)}` : randomToken();
  db.tx(() => insertGuest(db, uid, sid, token, expiresAt));
  return { token, userId: uid };
}

export function userFromToken(db: Db, token: string | undefined, cfg?: Config): SessionUser | null {
  if (!token) return null;
  if (cfg?.ephemeral && token.startsWith('g1.')) {
    const parts = token.split('.');
    // Tokens antigos ainda valem onde a sessão original existe, sem recriação em outra instância.
    if (parts.length !== 4) {
      const [, uid, sid, expiry, sig] = parts;
      const exp = Number(expiry);
      if (parts.length !== 5 || !uid || !sid || !sig || !Number.isSafeInteger(exp) || exp > 8.64e15 ||
          exp <= Date.now() || !safeEqual(sig, guestSig(cfg, uid, sid, exp))) return null;
      db.tx(() => insertGuest(db, uid, sid, token, new Date(exp).toISOString()));
    }
  }
  const row = db.get<{ id: string; email: string; role: SessionUser['role']; sid: string; last_seen_at: string | null; is_guest: number; verified_at: string | null }>(
    `SELECT u.id, u.email, u.role, u.is_guest, u.verified_at, s.id AS sid, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
    sha256(token), nowIso(),
  );
  if (!row) return null;
  // Equipe sem e-mail comprovado não tem sessão válida (defesa em profundidade para promoções feitas direto no banco).
  if (row.role !== 'reader' && !row.verified_at) return null;
  if (row.role !== 'reader' && row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) > STAFF_IDLE_DAYS * 86_400_000) {
    revokeSession(db, row.sid);
    return null;
  }
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
    db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), row.sid);
  }
  return { id: row.id, email: row.email, role: row.role, sessionId: row.sid, isGuest: row.is_guest === 1 };
}

export const revokeSession = (db: Db, sessionId: string) => db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), sessionId);
export const revokeAllSessions = (db: Db, userId: string) => db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);

/** Limpeza periódica (LGPD/minimização): desafios com mais de 30 dias, sessões vencidas ou revogadas, falhas antigas. */
export function purgeAuthData(db: Db, now = Date.now()) {
  const monthAgo = new Date(now - 30 * 86_400_000).toISOString();
  const nowS = new Date(now).toISOString();
  db.run('DELETE FROM auth_challenges WHERE created_at < ?', monthAgo);
  db.run('DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL', nowS);
  db.run('DELETE FROM login_failures WHERE created_at < ?', new Date(now - 86_400_000).toISOString());
  db.run('DELETE FROM rate_limits WHERE expires_at <= ?', now);
}

/** E-mail transacional. 'console' = caixa postal local de desenvolvimento (bloqueado em produção). */
async function sendMail(db: Db, cfg: Config, to: string, subject: string, body: string): Promise<void> {
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
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
// Assíncrono: scryptSync travaria o event loop de todas as requisições durante o cálculo.
export const hashPassword = async (pw: string) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
};
const checkPassword = async (pw: string, stored: string | null) => {
  const [kind, salt, hash] = (stored ?? 'scrypt$00$00').split('$');
  const got = await scryptAsync(pw, Buffer.from(salt ?? '', 'hex'), 64); // calcula sempre, para não revelar pelo tempo se a conta existe
  const want = Buffer.from(hash ?? '', 'hex');
  return kind === 'scrypt' && want.length === got.length && timingSafeEqual(got, want) && !!stored;
};

export async function registerWithPassword(db: Db, cfg: Config, email: string, password: string, guestUserId?: string, displayName?: string) {
  const passwordHash = await hashPassword(password);
  return db.tx(() => {
    if (db.get('SELECT 1 FROM users WHERE email = ? AND is_guest = 0', email)) {
      throw new AppError(409, 'email_taken', 'Já existe uma conta com este e-mail. Use "Entrar".');
    }
    const r = signIn(db, cfg, email, guestUserId, { verified: false, passwordHash, displayName });
    audit(db, r.userId, 'user.password_registered', 'user', r.userId);
    return r;
  });
}

export async function loginWithPassword(db: Db, cfg: Config, email: string, password: string, guestUserId?: string) {
  const since = new Date(Date.now() - PASSWORD_FAILURE_WINDOW_MIN * 60_000).toISOString();
  const fails = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND created_at > ?', email, since)!.n;
  if (fails >= MAX_PASSWORD_FAILURES) throw new AppError(429, 'rate_limited', `Muitas tentativas para este e-mail. Aguarde ${PASSWORD_FAILURE_WINDOW_MIN} minutos.`);
  const candidate = db.get<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE email = ? AND is_guest = 0', email);
  const matches = await checkPassword(password, candidate?.password_hash ?? null);
  const invalid = new AppError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
  if (!candidate || !matches) {
    db.run('INSERT INTO login_failures (email, created_at) VALUES (?,?)', email, nowIso());
    throw invalid;
  }
  const session = db.tx(() => {
    // A credencial e a elegibilidade podem mudar durante o scrypt.
    const current = db.get<{ id: string; password_hash: string | null; role: string; verified_at: string | null }>(
      'SELECT id, password_hash, role, verified_at FROM users WHERE email = ? AND is_guest = 0', email,
    );
    if (!current || current.id !== candidate.id || current.password_hash !== candidate.password_hash) return null;
    if (current.role !== 'reader' && !current.verified_at) return null;
    const result = signIn(db, cfg, email, guestUserId, { verified: false });
    db.run('DELETE FROM login_failures WHERE email = ?', email);
    return result;
  });
  if (!session) {
    db.run('INSERT INTO login_failures (email, created_at) VALUES (?,?)', email, nowIso());
    throw invalid;
  }
  return session;
}
