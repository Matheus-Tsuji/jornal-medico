-- 002: acesso de visitante (sem e-mail). O e-mail do visitante é um marcador interno .invalid, nunca usado para envio.
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
