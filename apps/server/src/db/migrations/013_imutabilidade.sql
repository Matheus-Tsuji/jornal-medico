-- Versão do validador que produziu a análise (rascunhos bloqueados por validador antigo podem ser refeitos).
ALTER TABLE analyses ADD COLUMN validator_version INTEGER;

-- Regra 3 também no banco: análise publicada é imutável. Só pode virar 'superseded' (correção = nova versão).
CREATE TRIGGER analyses_published_immutable BEFORE UPDATE ON analyses
WHEN OLD.status = 'published' AND (
  NEW.status NOT IN ('published', 'superseded')
  OR NEW.payload IS NOT OLD.payload OR NEW.validation IS NOT OLD.validation
  OR NEW.version IS NOT OLD.version OR NEW.article_id IS NOT OLD.article_id
  OR NEW.input_hash IS NOT OLD.input_hash OR NEW.model IS NOT OLD.model
  OR NEW.prompt_version IS NOT OLD.prompt_version OR NEW.published_at IS NOT OLD.published_at
  OR NEW.editorial_priority IS NOT OLD.editorial_priority
)
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;

CREATE TRIGGER evidence_results_published_immutable BEFORE UPDATE ON evidence_results
WHEN (SELECT status FROM analyses WHERE id = OLD.analysis_id) = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;

CREATE TRIGGER claims_published_immutable BEFORE UPDATE ON claims
WHEN (SELECT status FROM analyses WHERE id = OLD.analysis_id) = 'published'
BEGIN
  SELECT RAISE(ABORT, 'Análise publicada é imutável: crie nova versão.');
END;
