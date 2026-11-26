-- Perfil profissional do leitor (sobre, formação, certificados, publicações, redes) e opção de torná-lo público.
-- JSON validado por profileDetailsSchema (packages/contracts). Público só quando o próprio usuário liga.
ALTER TABLE users ADD COLUMN profile_details TEXT;
ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 0;
