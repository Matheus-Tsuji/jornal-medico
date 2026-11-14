-- 001: esquema inicial. Datas em UTC, ISO-8601 (TEXT). IDs TEXT estáveis.
-- SQL mantido no subconjunto portável para PostgreSQL (ver docs/architecture.md).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader','editor','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  profile TEXT,
  personalization_enabled INTEGER NOT NULL DEFAULT 1,
  onboarded_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_challenges_email ON auth_challenges(email, created_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES topics(id),
  slug TEXT NOT NULL UNIQUE,
  level TEXT NOT NULL CHECK (level IN ('area','subarea','tema')),
  label_pt TEXT NOT NULL,
  label_en TEXT,
  synonyms TEXT NOT NULL DEFAULT '[]',
  mesh_terms TEXT NOT NULL DEFAULT '[]',
  source_query TEXT,
  query_version INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  extra_parents TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  official_url TEXT NOT NULL,
  license_notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('active','planned','paused','error')),
  rate_limit_per_sec REAL NOT NULL DEFAULT 1,
  last_success_at TEXT,
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id),
  source_id TEXT REFERENCES sources(id),
  weight REAL NOT NULL DEFAULT 1,
  follow INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((topic_id IS NULL) <> (source_id IS NULL))
);
CREATE UNIQUE INDEX uq_pref_topic ON user_preferences(user_id, topic_id) WHERE topic_id IS NOT NULL;
CREATE UNIQUE INDEX uq_pref_source ON user_preferences(user_id, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE journals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  issn TEXT,
  eissn TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_journal_issn ON journals(issn) WHERE issn IS NOT NULL;
CREATE UNIQUE INDEX uq_journal_title ON journals(title) WHERE issn IS NULL;

CREATE TABLE journal_classifications (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES journals(id),
  system TEXT NOT NULL,
  stratum TEXT NOT NULL,
  cycle TEXT NOT NULL,
  area TEXT,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  doi TEXT UNIQUE,
  pmid TEXT UNIQUE,
  pmcid TEXT UNIQUE,
  original_title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '[]',
  journal_id TEXT REFERENCES journals(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  publication_types TEXT NOT NULL DEFAULT '[]',
  pub_date TEXT,
  indexed_at TEXT,
  canonical_url TEXT,
  access_status TEXT NOT NULL DEFAULT 'abstract_only',
  retraction_status TEXT NOT NULL DEFAULT 'none' CHECK (retraction_status IN ('none','corrected','retracted')),
  language TEXT,
  mesh_terms TEXT NOT NULL DEFAULT '[]',
  triage_status TEXT NOT NULL DEFAULT 'pending' CHECK (triage_status IN ('pending','eligible','excluded')),
  triage_reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_articles_pubdate ON articles(pub_date);
CREATE INDEX idx_articles_triage ON articles(triage_status);

CREATE TABLE article_sources (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  license TEXT NOT NULL,
  abstract_text TEXT,
  raw_meta TEXT NOT NULL DEFAULT '{}',
  UNIQUE (source_id, external_id, version)
);

CREATE TABLE article_topics (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  method TEXT NOT NULL,
  confidence REAL,
  PRIMARY KEY (article_id, topic_id)
);
CREATE INDEX idx_article_topics_topic ON article_topics(topic_id);

CREATE TABLE duplicate_candidates (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  other_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  UNIQUE (article_id, other_article_id)
);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt-BR',
  input_scope TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_review','blocked','rejected','published','superseded','demo')),
  payload TEXT NOT NULL,
  validation TEXT NOT NULL DEFAULT '[]',
  editorial_priority REAL NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (article_id, version)
);
CREATE INDEX idx_analyses_status ON analyses(status);

CREATE TABLE evidence_results (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  outcome_type TEXT NOT NULL,
  measure TEXT,
  measure_kind TEXT,
  estimate REAL,
  estimate_raw TEXT,
  unit TEXT,
  comparator TEXT,
  population TEXT,
  timepoint TEXT,
  ci_level REAL,
  ci_lower REAL,
  ci_upper REAL,
  ci_raw TEXT,
  p_raw TEXT,
  p_operator TEXT,
  p_value REAL,
  sample_size INTEGER,
  adjusted INTEGER,
  evidence_locator TEXT NOT NULL,
  evidence_quote TEXT,
  missing_reason TEXT
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  source_id TEXT,
  locator TEXT NOT NULL,
  quote TEXT,
  support TEXT NOT NULL,
  origin TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE editorial_reviews (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','request_changes')),
  justification TEXT NOT NULL,
  edits TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE article_corrections (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('correction','retraction','update')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE editions (
  id TEXT PRIMARY KEY,
  edition_date TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','superseded')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  coverage_note TEXT,
  composed_at TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT REFERENCES users(id),
  UNIQUE (edition_date, version, is_demo)
);

CREATE TABLE edition_items (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  slot TEXT NOT NULL CHECK (slot IN ('headline','secondary','section')),
  section_topic_id TEXT REFERENCES topics(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (edition_id, article_id)
);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id)
);

CREATE TABLE read_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('open','complete')),
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, article_id, kind, day)
);
CREATE INDEX idx_read_events_article ON read_events(article_id, created_at);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, article_id)
);

CREATE TABLE error_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  created_at TEXT NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  interval TEXT NOT NULL DEFAULT 'month',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('incomplete','trialing','active','past_due','canceled')),
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE (provider, external_event_id)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued','running','retry','completed','failed','blocked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TEXT NOT NULL,
  locked_by TEXT,
  lease_until TEXT,
  last_error TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_ready ON jobs(status, next_run_at);

CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  topic_id TEXT REFERENCES topics(id),
  job_id TEXT,
  query TEXT NOT NULL,
  query_version INTEGER NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  found INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE source_cursors (
  source_id TEXT NOT NULL REFERENCES sources(id),
  topic_id TEXT NOT NULL REFERENCES topics(id),
  cursor_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, topic_id)
);

CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  article_id TEXT,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  price_table_version TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_events(created_at);

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dev_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
