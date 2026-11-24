-- Falhas de login por senha, por e-mail (bloqueio temporário contra tentativa distribuída de senhas).
CREATE TABLE login_failures (
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_login_failures_email ON login_failures (email, created_at);
