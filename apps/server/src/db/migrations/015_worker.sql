-- Rechecagem de retratação em rodízio: quem foi conferido há mais tempo (ou nunca) vem primeiro.
ALTER TABLE articles ADD COLUMN retraction_checked_at TEXT;
-- Duplicata por título usa lower(original_title): sem este índice, cada inserção varria a tabela inteira.
CREATE INDEX idx_articles_title_lower ON articles (lower(original_title));
-- Reserva de orçamento de IA para chamadas em andamento (o teto diário vale mesmo com várias em paralelo).
CREATE TABLE ai_budget_reservations (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  amount_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);
