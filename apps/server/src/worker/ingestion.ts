// Descoberta incremental + normalização + deduplicação + triagem determinística.
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { NormalizedRecord, ScientificSourceAdapter } from '../sources/pubmed.ts';
import { addDays, id, localDate, nowIso, sha256, slugify } from '../lib/util.ts';
import { analyzePriority, enqueue } from '../modules/jobs.ts';
import { PROMPT_VERSION } from '../ai/analysis.ts';
import { syncQualis } from '../modules/grade.ts';

const ALLOWED_TYPES = ['Randomized Controlled Trial', 'Clinical Trial', 'Clinical Trial, Phase III', 'Meta-Analysis', 'Systematic Review', 'Practice Guideline', 'Guideline', 'Observational Study', 'Multicenter Study', 'Comparative Study', 'Consensus Development Conference'];
const EXCLUDED_TYPES = ['Comment', 'Editorial', 'Letter', 'Erratum', 'Published Erratum', 'News', 'Retraction of Publication'];
const LANGS = ['eng', 'por', 'spa'];

export function triage(r: NormalizedRecord): { status: 'eligible' | 'excluded'; reason: string } {
  if (r.retracted) return { status: 'excluded', reason: 'Publicação retratada' };
  const ex = r.publicationTypes.find((t) => EXCLUDED_TYPES.includes(t));
  if (ex) return { status: 'excluded', reason: `Tipo de publicação fora do escopo: ${ex}` };
  if (!r.publicationTypes.some((t) => ALLOWED_TYPES.includes(t))) return { status: 'excluded', reason: `Tipo não priorizado: ${r.publicationTypes.join(', ') || 'desconhecido'}` };
  if (r.language && !LANGS.includes(r.language)) return { status: 'excluded', reason: `Idioma ${r.language}` };
  if (!r.abstract) return { status: 'excluded', reason: 'Sem abstract: apenas metadados disponíveis' };
  // Resultado negativo NÃO é critério de exclusão.
  return { status: 'eligible', reason: 'Regras determinísticas atendidas' };
}

/**
 * Artigo elegível ainda sem análise ganha job de análise, na mesma transação da gravação. Idempotente pela chave:
 * reexecutar depois de uma falha no meio do lote não deixa artigo gravado sem job.
 */
function ensureAnalysisJob(db: Db, articleId: string, publicationTypes: string[]): boolean {
  const a = db.get<{ triage_status: string; retraction_status: string }>('SELECT triage_status, retraction_status FROM articles WHERE id = ?', articleId)!;
  if (a.triage_status !== 'eligible' || a.retraction_status === 'retracted') return false;
  if (db.get('SELECT 1 FROM analyses WHERE article_id = ? LIMIT 1', articleId)) return false;
  return enqueue(db, 'analyze', `analyze:${articleId}:${PROMPT_VERSION}`, { articleId }, { priority: analyzePriority(publicationTypes) }).created;
}

/** Upsert com deduplicação: DOI normalizado → PMID → PMCID. Título parecido gera candidato, não merge. */
export function upsertRecord(db: Db, sourceId: string, topicId: string, r: NormalizedRecord): { articleId: string; inserted: boolean; queued: boolean } {
  return db.tx(() => {
    const existing =
      (r.doi && db.get<{ id: string }>('SELECT id FROM articles WHERE doi = ?', r.doi)) ||
      (r.pmid && db.get<{ id: string }>('SELECT id FROM articles WHERE pmid = ?', r.pmid)) ||
      (r.pmcid && db.get<{ id: string }>('SELECT id FROM articles WHERE pmcid = ?', r.pmcid)) ||
      undefined;
    const hash = sha256(JSON.stringify([r.title, r.abstract, r.publicationTypes, r.retracted, r.corrected]));
    const retraction = r.retracted ? 'retracted' : r.corrected ? 'corrected' : 'none';
    if (existing) {
      db.run(
        `UPDATE articles SET doi = COALESCE(doi, ?), pmid = COALESCE(pmid, ?), pmcid = COALESCE(pmcid, ?),
            retraction_status = CASE WHEN ? = 'retracted' THEN 'retracted' WHEN retraction_status = 'none' THEN ? ELSE retraction_status END, updated_at = ?
          WHERE id = ?`,
        r.doi, r.pmid, r.pmcid, retraction, retraction, nowIso(), existing.id,
      );
      db.run("INSERT OR IGNORE INTO article_topics (article_id, topic_id, method, confidence) VALUES (?,?, 'source_query', 0.8)", existing.id, topicId);
      const prev = db.get<{ content_hash: string }>('SELECT content_hash FROM article_sources WHERE article_id = ? AND source_id = ? ORDER BY retrieved_at DESC LIMIT 1', existing.id, sourceId);
      if (!prev) {
        // Primeira vez que esta fonte traz o artigo: registra (pode trazer o abstract que faltava).
        insertSource(db, existing.id, sourceId, r, hash, '1');
      } else if (prev.content_hash !== hash) {
        const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ? AND source_id = ?', existing.id, sourceId)!.n;
        insertSource(db, existing.id, sourceId, r, hash, String(n + 1));
        if (r.retracted) db.run("INSERT INTO article_corrections (id, article_id, kind, note, created_at) VALUES (?,?, 'retraction', ?, ?)", id(), existing.id, 'PubMed indica retratação desta publicação.', nowIso());
      }
      // Abstract que chegou depois: refaz a triagem só se o motivo da exclusão era a falta dele (exclusão por tipo,
      // idioma ou pela triagem de IA continua valendo).
      if (r.abstract) {
        const cur = db.get<{ triage_status: string; triage_reason: string | null }>('SELECT triage_status, triage_reason FROM articles WHERE id = ?', existing.id)!;
        const t = triage(r);
        if (cur.triage_status === 'excluded' && cur.triage_reason?.startsWith('Sem abstract') && t.status === 'eligible') {
          db.run("UPDATE articles SET triage_status = 'eligible', triage_reason = ?, access_status = 'abstract_only', updated_at = ? WHERE id = ?", t.reason, nowIso(), existing.id);
        }
      }
      return { articleId: existing.id, inserted: false, queued: ensureAnalysisJob(db, existing.id, r.publicationTypes) };
    }
    let journalId: string | null = null;
    if (r.journal?.title) {
      const j = (r.journal.issn && db.get<{ id: string }>('SELECT id FROM journals WHERE issn = ?', r.journal.issn)) ||
        db.get<{ id: string }>('SELECT id FROM journals WHERE title = ?', r.journal.title);
      journalId = j ? j.id : id();
      if (!j) db.run('INSERT INTO journals (id, title, issn, eissn, created_at) VALUES (?,?,?,?,?)', journalId, r.journal.title, r.journal.issn, r.journal.eissn, nowIso());
    }
    const articleId = id();
    const t = triage(r);
    db.run(
      `INSERT INTO articles (id, slug, doi, pmid, pmcid, original_title, authors, journal_id, source_id, publication_types, pub_date, indexed_at, canonical_url,
        access_status, retraction_status, language, mesh_terms, triage_status, triage_reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      articleId, `${slugify(r.title, 70)}-${r.pmid ? `pmid${r.pmid}` : slugify(r.pmcid ?? r.externalId, 30)}`, r.doi, r.pmid, r.pmcid, r.title, JSON.stringify(r.authors), journalId, sourceId,
      JSON.stringify(r.publicationTypes), r.pubDate, r.indexedAt, r.url, r.abstract ? 'abstract_only' : 'metadata_only', retraction, r.language,
      JSON.stringify(r.mesh), t.status, t.reason, nowIso(), nowIso(),
    );
    insertSource(db, articleId, sourceId, r, hash, '1');
    db.run("INSERT INTO article_topics (article_id, topic_id, method, confidence) VALUES (?,?, 'source_query', 0.8)", articleId, topicId);
    // Possível duplicata por título (ex.: preprint vs publicação): só sinaliza.
    const twin = db.get<{ id: string }>('SELECT id FROM articles WHERE lower(original_title) = lower(?) AND id <> ? LIMIT 1', r.title, articleId);
    if (twin) db.run('INSERT OR IGNORE INTO duplicate_candidates (id, article_id, other_article_id, reason, created_at) VALUES (?,?,?,?,?)', id(), articleId, twin.id, 'Título idêntico com identificadores diferentes', nowIso());
    return { articleId, inserted: true, queued: ensureAnalysisJob(db, articleId, r.publicationTypes) };
  });
}

function insertSource(db: Db, articleId: string, sourceId: string, r: NormalizedRecord, hash: string, version: string) {
  db.run(
    `INSERT OR IGNORE INTO article_sources (id, article_id, source_id, external_id, version, retrieved_at, content_hash, license, abstract_text, raw_meta)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id(), articleId, sourceId, r.externalId, version, nowIso(), hash, 'abstract-copyright-unverified', r.abstract,
    JSON.stringify({ mesh: r.mesh, publicationTypes: r.publicationTypes, journal: r.journal, indexedAt: r.indexedAt }),
  );
}

/** Uma execução de descoberta para (fonte, tema). O cursor só avança se tudo concluir. */
export async function discover(db: Db, cfg: Config, adapter: ScientificSourceAdapter, topicSlug: string, jobId: string | null = null) {
  const topic = db.get<{ id: string; label: string; source_query: string | null; query_version: number; enabled: number }>('SELECT id, label_pt AS label, source_query, query_version, enabled FROM topics WHERE slug = ?', topicSlug);
  if (!topic?.source_query || topic.enabled !== 1) throw new Error(`Tema sem consulta habilitada: ${topicSlug}`);
  const source = db.get<{ id: string }>('SELECT id FROM sources WHERE slug = ? AND enabled = 1', adapter.slug);
  if (!source) throw new Error(`Fonte desabilitada: ${adapter.slug}`);
  const cursor = db.get<{ cursor_date: string }>('SELECT cursor_date FROM source_cursors WHERE source_id = ? AND topic_id = ?', source.id, topic.id);
  const today = localDate(cfg.APP_TIMEZONE);
  // Janela sobreposta recupera indexação tardia; a deduplicação absorve repetições.
  const from = cursor ? addDays(`${cursor.cursor_date}T00:00:00Z`, -cfg.INGEST_OVERLAP_DAYS).slice(0, 10) : addDays(`${today}T00:00:00Z`, -7).slice(0, 10);
  const runId = id();
  db.run(
    `INSERT INTO ingestion_runs (id, source_id, topic_id, job_id, query, query_version, window_from, window_to, status, started_at) VALUES (?,?,?,?,?,?,?,?, 'running', ?)`,
    runId, source.id, topic.id, jobId, topic.source_query, topic.query_version, from, today, nowIso(),
  );
  try {
    adapter = adapter.newRun?.() ?? adapter;
    // Janela maior que o limite por busca: divide o intervalo de datas ao meio até cada pedaço caber. Um único dia
    // que ainda não cabe deixa a janela incompleta, e aí o cursor NÃO avança (nada fica para trás em silêncio).
    const ids = new Set<string>();
    let found = 0;
    let incomplete: string | null = null;
    const collect = async (a: string, b: string): Promise<void> => {
      const res = await adapter.search(topic.source_query!, a, b, cfg.INGEST_MAX_PER_TOPIC, topic.label);
      if (res.total > res.ids.length && a < b) {
        const days = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
        const mid = addDays(`${a}T00:00:00Z`, Math.floor(days / 2)).slice(0, 10);
        await collect(a, mid);
        await collect(addDays(`${mid}T00:00:00Z`, 1).slice(0, 10), b);
        return;
      }
      found += res.total;
      res.ids.forEach((x) => ids.add(x));
      if (res.total > res.ids.length) incomplete = `Dia ${a} com ${res.total} resultados e limite de ${res.ids.length}; aumente INGEST_MAX_PER_TOPIC.`;
    };
    await collect(from, today);
    const records = await adapter.fetchDetails([...ids]);
    let inserted = 0;
    let duplicates = 0;
    let queued = 0;
    for (const r of records) {
      const res = upsertRecord(db, source.id, topic.id, r);
      if (res.inserted) inserted++;
      else duplicates++;
      if (res.queued) queued++;
    }
    db.tx(() => {
      db.run("UPDATE ingestion_runs SET status = 'completed', found = ?, inserted = ?, duplicates = ?, error = ?, finished_at = ? WHERE id = ?", found, inserted, duplicates, incomplete, nowIso(), runId);
      if (!incomplete) {
        db.run(
          'INSERT INTO source_cursors (source_id, topic_id, cursor_date, updated_at) VALUES (?,?,?,?) ON CONFLICT (source_id, topic_id) DO UPDATE SET cursor_date = excluded.cursor_date, updated_at = excluded.updated_at',
          source.id, topic.id, today, nowIso(),
        );
      }
      db.run('UPDATE sources SET last_success_at = ?, last_error = NULL WHERE id = ?', nowIso(), source.id);
      syncQualis(db); // revistas novas que já estão na tabela consultada ganham o Qualis
    });
    return { runId, found, fetched: records.length, inserted, duplicates, queuedForAnalysis: queued, incomplete };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    db.run("UPDATE ingestion_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", msg, nowIso(), runId);
    db.run('UPDATE sources SET last_error = ? WHERE id = ?', msg, source.id);
    throw e;
  }
}
