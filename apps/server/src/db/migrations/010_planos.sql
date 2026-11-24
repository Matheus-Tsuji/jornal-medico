-- Planos de 2026-11-24: Grátis (sem cobrança, não é linha aqui), Básico R$ 29,90 e Pro R$ 49,90.
UPDATE plans SET active = 0 WHERE slug IN ('beta-mensal', 'referencia-mensal');
INSERT OR IGNORE INTO plans (id, slug, name, description, price_cents, active)
  VALUES (lower(hex(randomblob(16))), 'basico', 'Básico', 'Análise completa de todos os estudos.', 2990, 1);
INSERT OR IGNORE INTO plans (id, slug, name, description, price_cents, active)
  VALUES (lower(hex(randomblob(16))), 'pro', 'Pro', 'Tudo do Básico, mais a pergunta do estudo (PICO/PECO) e recursos de assinante.', 4990, 1);
