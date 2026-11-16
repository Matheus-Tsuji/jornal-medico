-- Europe PMC passa a ser buscado no ciclo diário (só registros fora do PubMed).
UPDATE sources SET status = 'active', enabled = 1,
  license_notes = 'Só o que não está no PubMed (artigos do PubMed Central e livros do NCBI). Abstract para uso interno de revisão; licença do texto varia por artigo.'
WHERE slug = 'europepmc';
