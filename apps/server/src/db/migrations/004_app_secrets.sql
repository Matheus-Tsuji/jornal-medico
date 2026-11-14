-- 004: segredos gerados pela própria aplicação quando não vêm do ambiente (ex.: primeiro deploy na Vercel).
-- Ficam no banco, que já é dado sensível; nunca são enviados à interface nem aos logs.
CREATE TABLE app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
