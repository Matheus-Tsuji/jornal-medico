CREATE TABLE monitored_documents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('regulation','publication')),
  payload TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);
CREATE INDEX idx_monitored_source ON monitored_documents(source, retrieved_at);
CREATE TABLE monitor_sync (
  source TEXT PRIMARY KEY,
  last_success_at TEXT,
  last_error TEXT
);
INSERT OR IGNORE INTO sources (id,slug,name,kind,official_url,license_notes,status,rate_limit_per_sec,enabled)
VALUES ('source-camara','camara','Câmara dos Deputados — proposições em saúde','government','https://dadosabertos.camara.leg.br/','Metadados oficiais. Proposição não é lei em vigor.','active',1,1);
UPDATE sources SET status='active',enabled=1 WHERE slug='crossref';
