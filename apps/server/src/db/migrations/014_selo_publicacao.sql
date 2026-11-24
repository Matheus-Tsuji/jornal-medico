-- Selo de publicação: completa a imutabilidade da 013 (que só cobria UPDATE de análise 'published').
-- Uma análise ganha selo quando é APROVADA pelo fluxo editorial (UPDATE para 'published'). Com selo:
--   - a análise não pode ser apagada; só pode ir de 'published' para 'superseded' (correção = nova versão);
--     depois de 'superseded' não muda mais;
--   - evidence_results e claims dela não aceitam INSERT, UPDATE nem DELETE.
-- Por que selo e não "status = published": copyDb (db:push/db:export) apaga e reinsere todas as tabelas em ordem de
-- criação. Inserir uma análise já publicada não sela; esta tabela é criada depois das filhas, então a cópia insere as
-- filhas antes dos selos e, ao limpar o destino, apaga os selos antes das filhas. Seeds de demonstração ('demo') não
-- são selados. Quem tem SQL direto pode apagar selos (como pode apagar triggers): a proteção é contra bugs do app.
CREATE TABLE analysis_seals (
  analysis_id TEXT PRIMARY KEY REFERENCES analyses(id),
  sealed_at TEXT NOT NULL
);

INSERT INTO analysis_seals (analysis_id, sealed_at)
  SELECT id, COALESCE(published_at, created_at) FROM analyses
   WHERE is_demo = 0 AND (status = 'published' OR (status = 'superseded' AND published_at IS NOT NULL));
-- Rascunho/bloqueada substituídos por reprocessamento também viram 'superseded', mas nunca foram publicados
-- (published_at nulo): ficam sem selo.

CREATE TRIGGER analyses_seal_on_publish AFTER UPDATE OF status ON analyses
WHEN NEW.status = 'published' AND OLD.status IS NOT 'published' AND NEW.is_demo = 0
BEGIN
  INSERT OR IGNORE INTO analysis_seals (analysis_id, sealed_at) VALUES (NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER analysis_seals_no_update BEFORE UPDATE ON analysis_seals
BEGIN
  SELECT RAISE(ABORT, 'Selo de publicação é permanente.');
END;

-- Selada: só a transição published → superseded, sem mexer em nenhuma outra coluna.
CREATE TRIGGER analyses_sealed_update BEFORE UPDATE ON analyses
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id = OLD.id) AND NOT (
  OLD.status = 'published' AND NEW.status IN ('published', 'superseded')
  AND NEW.id IS OLD.id AND NEW.article_id IS OLD.article_id AND NEW.version IS OLD.version
  AND NEW.payload IS OLD.payload AND NEW.validation IS OLD.validation AND NEW.input_hash IS OLD.input_hash
  AND NEW.model IS OLD.model AND NEW.prompt_version IS OLD.prompt_version AND NEW.published_at IS OLD.published_at
  AND NEW.editorial_priority IS OLD.editorial_priority AND NEW.is_demo IS OLD.is_demo
  AND NEW.input_scope IS OLD.input_scope AND NEW.language IS OLD.language AND NEW.created_at IS OLD.created_at
  AND NEW.validator_version IS OLD.validator_version
)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;

CREATE TRIGGER analyses_sealed_delete BEFORE DELETE ON analyses
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;

CREATE TRIGGER evidence_results_sealed_insert BEFORE INSERT ON evidence_results
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id = NEW.analysis_id)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;
CREATE TRIGGER evidence_results_sealed_update BEFORE UPDATE ON evidence_results
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id IN (OLD.analysis_id, NEW.analysis_id))
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;
CREATE TRIGGER evidence_results_sealed_delete BEFORE DELETE ON evidence_results
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id = OLD.analysis_id)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;

CREATE TRIGGER claims_sealed_insert BEFORE INSERT ON claims
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id = NEW.analysis_id)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;
CREATE TRIGGER claims_sealed_update BEFORE UPDATE ON claims
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id IN (OLD.analysis_id, NEW.analysis_id))
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;
CREATE TRIGGER claims_sealed_delete BEFORE DELETE ON claims
WHEN EXISTS (SELECT 1 FROM analysis_seals WHERE analysis_id = OLD.analysis_id)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;
