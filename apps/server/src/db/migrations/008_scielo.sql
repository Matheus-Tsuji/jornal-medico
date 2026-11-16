-- SciELO passa a ser buscado no ciclo diário, via Crossref (DOIs 10.1590).
UPDATE sources SET kind = 'bibliographic_api', status = 'active', enabled = 1,
  license_notes = 'Metadados e abstracts via Crossref (DOI 10.1590). Licença CC por artigo; abstract só para uso interno de revisão.'
WHERE slug = 'scielo';
