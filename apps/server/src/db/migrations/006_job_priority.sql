-- 006: prioridade na fila. O ciclo diário pega primeiro a coleta (o dia fica conhecido antes das análises) e,
-- entre as análises, o que tem mais chance de ser evidência forte. Valores em modules/jobs.ts (PRIORITY).
ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_jobs_priority ON jobs(status, priority DESC, next_run_at);

UPDATE jobs SET priority = 50 WHERE type <> 'analyze';
UPDATE jobs SET priority = (
  SELECT CASE
    WHEN ar.publication_types LIKE '%Meta-Analysis%' OR ar.publication_types LIKE '%Systematic Review%' THEN 30
    WHEN ar.publication_types LIKE '%Randomized Controlled Trial%' OR ar.publication_types LIKE '%Guideline%' OR ar.publication_types LIKE '%Phase III%' THEN 20
    ELSE 10 END
  FROM articles ar WHERE ar.id = json_extract(jobs.payload, '$.articleId')
) WHERE type = 'analyze' AND EXISTS (SELECT 1 FROM articles ar WHERE ar.id = json_extract(jobs.payload, '$.articleId'));
