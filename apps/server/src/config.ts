// Configuração validada na inicialização. Falha cedo, com mensagem clara.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db/index.ts';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const optStr = z.string().optional().transform((v) => (v ? v : undefined));
const optNum = z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('file:./data/journal.db'),
  /** Token do Turso quando DATABASE_URL é remoto (libsql://…). */
  DATABASE_AUTH_TOKEN: optStr,
  /** Vercel Cron envia "Authorization: Bearer <CRON_SECRET>". */
  CRON_SECRET: optStr,
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),
  EDITION_HOUR: z.string().regex(/^\d{2}:\d{2}$/).default('06:00'),
  BRAND_NAME: z.string().default('Jornal Médico'),
  SESSION_SECRET: optStr,
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  ADMIN_EMAILS: z.string().default(''),
  AUTH_EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  AUTH_EMAIL_API_KEY: optStr,
  AUTH_EMAIL_FROM: optStr,
  OPENAI_API_KEY: optStr,
  OPENAI_TRIAGE_MODEL: optStr,
  OPENAI_ANALYSIS_MODEL: optStr,
  OPENAI_EDITORIAL_MODEL: optStr,
  AI_DAILY_BUDGET_USD: optNum,
  AI_MONTHLY_BUDGET_USD: optNum,
  AI_MAX_ARTICLES_PER_DAY: z.coerce.number().int().min(0).default(20),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).default(6000),
  NCBI_API_KEY: optStr,
  NCBI_TOOL: z.string().default('jornal_medico'),
  NCBI_CONTACT_EMAIL: optStr,
  // Máximo de registros lidos por tema em cada busca. Precisa cobrir a janela inteira: o que passar disso não é
  // revisitado (o cursor avança). Volume real observado: até 45 em 8 dias por tema.
  INGEST_MAX_PER_TOPIC: z.coerce.number().int().min(1).max(1000).default(200),
  /** Jobs em paralelo no ciclo diário (buscas e análises esperam a rede quase todo o tempo). */
  // 8 testado em 2026-11-16: 82 análises em ~8 min, sem HTTP 429 da OpenAI.
  CYCLE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(8),
  /** Análise que espera vaga na fila por mais que isso sai dela (com motivo; reenfileirável no painel). */
  ANALYZE_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  INGEST_OVERLAP_DAYS: z.coerce.number().int().min(0).max(30).default(3),
  PAYMENT_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  PAYMENT_WEBHOOK_SECRET: optStr,
  PAYWALL_ENABLED: bool,
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).default(3),
  RECOMMENDER_URL: optStr,
  RANKING_MIN_READERS: z.coerce.number().int().min(1).default(3),
  FEATURE_REAL_CONTENT: bool,
  FEATURE_NOTION: bool,
  FEATURE_CLICKUP: bool,
  FEATURE_AUDIO: bool,
  FEATURE_VIDEO: bool,
  FEATURE_PWA: bool,
  WEB_DIST: optStr,
});

export type Config = z.infer<typeof schema> & {
  sessionSecret: string; adminEmails: Set<string>; dbPath: string; emailLogin: boolean;
  /** Banco de vitrine em /tmp (sem Turso): o que os leitores salvam pode se perder. */
  ephemeral?: boolean;
};

/** Completa segredos ausentes com valores gerados uma vez e guardados no banco (tabela app_secrets). */
export function ensureSecrets(db: Db, cfg: Config): void {
  const get = (name: string) => {
    db.run('INSERT OR IGNORE INTO app_secrets (name, value, created_at) VALUES (?,?,?)', name, randomBytes(32).toString('hex'), new Date().toISOString());
    return db.get<{ value: string }>('SELECT value FROM app_secrets WHERE name = ?', name)!.value;
  };
  if (!cfg.sessionSecret) cfg.sessionSecret = get('session_secret');
  if (!cfg.PAYMENT_WEBHOOK_SECRET) cfg.PAYMENT_WEBHOOK_SECRET = get('payment_webhook_secret');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // A integração Turso da Vercel cria TURSO_DATABASE_URL/TURSO_AUTH_TOKEN; os nomes próprios têm prioridade.
  env = { ...env, DATABASE_URL: env.DATABASE_URL || env.TURSO_DATABASE_URL, DATABASE_AUTH_TOKEN: env.DATABASE_AUTH_TOKEN || env.TURSO_AUTH_TOKEN };
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${msg}`);
  }
  const c = parsed.data;
  const prod = c.NODE_ENV === 'production';
  if (prod) {
    // Em produção não há segredo fixo de desenvolvimento: SESSION_SECRET e PAYMENT_WEBHOOK_SECRET vêm do ambiente
    // ou são gerados uma vez e guardados no banco (ensureSecrets). Sem provedor de e-mail real, o login por código
    // fica desligado (emailLogin = false) e só o acesso de visitante funciona; o código nunca aparece na tela.
    if (c.SESSION_SECRET && c.SESSION_SECRET.length < 32) throw new Error('Produção exige SESSION_SECRET com 32 caracteres ou mais.');
  }
  if (c.AUTH_EMAIL_PROVIDER === 'resend' && (!c.AUTH_EMAIL_API_KEY || !c.AUTH_EMAIL_FROM)) {
    throw new Error('AUTH_EMAIL_PROVIDER=resend exige AUTH_EMAIL_API_KEY e AUTH_EMAIL_FROM');
  }
  if (c.OPENAI_API_KEY && !(c.OPENAI_ANALYSIS_MODEL && c.OPENAI_EDITORIAL_MODEL)) {
    throw new Error('Com OPENAI_API_KEY, defina OPENAI_ANALYSIS_MODEL e OPENAI_EDITORIAL_MODEL (IDs do catálogo do seu projeto OpenAI). OPENAI_TRIAGE_MODEL (opcional) liga a triagem por IA antes da análise.');
  }
  for (const field of ['OPENAI_TRIAGE_MODEL', 'OPENAI_ANALYSIS_MODEL', 'OPENAI_EDITORIAL_MODEL'] as const) {
    if (c[field] && !['gpt-6.1-terra', 'gpt-6-luna'].includes(c[field])) {
      throw new Error(`${field}: use gpt-6.1-terra ou gpt-6-luna. Modelos fora desta lista não são permitidos.`);
    }
  }
  const dbPath = c.DATABASE_URL.replace(/^file:/, '');
  return {
    ...c,
    // Fora de produção, um segredo fixo de desenvolvimento evita configuração manual.
    sessionSecret: c.SESSION_SECRET ?? (prod ? '' : 'dev-only-secret-not-for-production-000000'),
    PAYMENT_WEBHOOK_SECRET: c.PAYMENT_WEBHOOK_SECRET ?? (prod ? undefined : 'dev-only-webhook-secret'),
    emailLogin: !(prod && c.AUTH_EMAIL_PROVIDER === 'console'),
    adminEmails: new Set(c.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
    dbPath,
  };
}
