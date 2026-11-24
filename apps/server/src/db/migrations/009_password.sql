-- Login com e-mail e senha (hash scrypt com sal; nunca a senha em texto).
ALTER TABLE users ADD COLUMN password_hash TEXT;
