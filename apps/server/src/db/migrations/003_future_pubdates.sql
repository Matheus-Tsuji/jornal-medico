-- 003: artigos ingeridos com a data da edição impressa no futuro passam a usar a data de entrada no PubMed.
UPDATE articles SET pub_date = indexed_at WHERE is_demo = 0 AND pub_date > date('now') AND indexed_at IS NOT NULL;
