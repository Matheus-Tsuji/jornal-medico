// Funde o CONTEÚDO do banco de trabalho (vitrine.db: o que a rotina diária coletou e analisou, versionado no Git) no
// banco de produção (Turso). Roda no build da Vercel, que já tem as credenciais do Turso: a rotina agendada nunca
// vê chave nenhuma, só escreve no GitHub.
//
// Regras de segurança (o banco de produção manda; a fusão só ACRESCENTA):
// - só mexe em conteúdo (artigos, fontes do artigo, temas do artigo, análises em rascunho, Qualis, correções, documentos
//   monitorados). Nunca em usuários, sessões, assinaturas, leitura, salvos, avaliações, auditoria, jobs ou edições;
// - análise 'published'/'demo' (ou com published_at) NUNCA é importada: publicar é decisão do editor, feita em produção;
// - análise já existente em produção nunca é reescrita (só rascunho → superseded, como o reprocessamento faz);
// - artigo é casado por id, DOI, PMID, PMCID e slug; temas, fontes e revistas por chave natural (slug/ISSN/título),
//   porque os ids deles são gerados em cada banco;
// - repetir a fusão não muda nada (idempotente).
import type { Db, Params, Row } from './index.ts';

const BATCH = 50;
const q = (n: string) => `"${n.replace(/"/g, '""')}"`;

export interface MergeResult {
  articles: number; articlesUpdated: number; articleSources: number; analyses: number; superseded: number;
  documents: number; skipped: string[];
}

function insertIgnore(dst: Db, table: string, rows: Row[]): number {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]!);
  const one = `(${cols.map(() => '?').join(',')})`;
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    n += Number(dst.run(
      `INSERT OR IGNORE INTO ${q(table)} (${cols.map(q).join(',')}) VALUES ${chunk.map(() => one).join(',')}`,
      ...(chunk.flatMap((r) => cols.map((c) => r[c])) as Params),
    ).changes);
  }
  return n;
}

const journalKey = (j: { issn: string | null; title: string }) => (j.issn ? `i:${j.issn}` : `t:${j.title}`);
const maxVersion = (m: Map<string, Set<number>>, article: string) => Math.max(0, ...(m.get(article) ?? []));

export function mergeContent(src: Db, dst: Db): MergeResult {
  const res: MergeResult = { articles: 0, articlesUpdated: 0, articleSources: 0, analyses: 0, superseded: 0, documents: 0, skipped: [] };

  // ---- Leitura do destino e mapas de ids (tudo em memória: poucas idas e voltas na rede) ----
  const bySlug = (table: 'topics' | 'sources') => new Map(dst.all<{ id: string; slug: string }>(`SELECT id, slug FROM ${table}`).map((r) => [r.slug, r.id]));
  const dstTopics = bySlug('topics');
  const dstSources = bySlug('sources');
  const topicMap = new Map<string, string>();
  for (const t of src.all<{ id: string; slug: string }>('SELECT id, slug FROM topics')) if (dstTopics.has(t.slug)) topicMap.set(t.id, dstTopics.get(t.slug)!);
  const sourceMap = new Map<string, string>();
  for (const s of src.all<{ id: string; slug: string }>('SELECT id, slug FROM sources')) if (dstSources.has(s.slug)) sourceMap.set(s.id, dstSources.get(s.slug)!);

  const dstJournals = new Map(dst.all<{ id: string; title: string; issn: string | null }>('SELECT id, title, issn FROM journals').map((j) => [journalKey(j), j.id]));
  const journalMap = new Map<string, string>();
  const newJournals: Row[] = [];
  for (const j of src.all<Row & { id: string; title: string; issn: string | null }>('SELECT * FROM journals')) {
    const hit = dstJournals.get(journalKey(j));
    if (hit) journalMap.set(j.id, hit);
    else { journalMap.set(j.id, j.id); newJournals.push(j); }
  }

  type DstArt = { id: string; slug: string; doi: string | null; pmid: string | null; pmcid: string | null; retraction_status: string; triage_status: string; triage_reason: string | null };
  const dstArts = dst.all<DstArt>('SELECT id, slug, doi, pmid, pmcid, retraction_status, triage_status, triage_reason FROM articles');
  const byId = new Map(dstArts.map((a) => [a.id, a]));
  const index = (k: 'slug' | 'doi' | 'pmid' | 'pmcid') => new Map(dstArts.filter((a) => a[k]).map((a) => [a[k]!, a]));
  const bySlugA = index('slug'); const byDoi = index('doi'); const byPmid = index('pmid'); const byPmcid = index('pmcid');

  const artMap = new Map<string, string>();
  const newArticles: Row[] = [];
  const updates: { id: string; set: string; params: Params }[] = [];
  for (const a of src.all<Row & { id: string; slug: string; doi: string | null; pmid: string | null; pmcid: string | null; journal_id: string | null; source_id: string; retraction_status: string; triage_status: string }>('SELECT * FROM articles WHERE is_demo = 0')) {
    const hit = byId.get(a.id) ?? (a.doi ? byDoi.get(a.doi) : undefined) ?? (a.pmid ? byPmid.get(a.pmid) : undefined)
      ?? (a.pmcid ? byPmcid.get(a.pmcid) : undefined) ?? bySlugA.get(a.slug);
    if (hit) {
      artMap.set(a.id, hit.id);
      // Só estados automáticos, e só no sentido seguro: retratação nunca é desfeita; triagem só reabre por falta de abstract.
      if (a.retraction_status === 'retracted' && hit.retraction_status !== 'retracted') updates.push({ id: hit.id, set: "retraction_status = 'retracted'", params: [] });
      else if (a.retraction_status === 'corrected' && hit.retraction_status === 'none') updates.push({ id: hit.id, set: "retraction_status = 'corrected'", params: [] });
      if (hit.triage_status === 'excluded' && hit.triage_reason?.startsWith('Sem abstract') && a.triage_status === 'eligible') {
        updates.push({ id: hit.id, set: "triage_status = 'eligible', triage_reason = 'Regras determinísticas atendidas', access_status = 'abstract_only'", params: [] });
      }
      continue;
    }
    const source = sourceMap.get(a.source_id);
    if (!source) { res.skipped.push(`artigo ${a.id}: fonte sem correspondente`); continue; }
    artMap.set(a.id, a.id);
    newArticles.push({ ...a, source_id: source, journal_id: a.journal_id ? journalMap.get(a.journal_id) ?? null : null });
  }

  // ---- Análises (rascunhos) ----
  type DstAn = { id: string; article_id: string; version: number; input_hash: string; status: string };
  const dstAn = dst.all<DstAn>('SELECT id, article_id, version, input_hash, status FROM analyses');
  const anById = new Map(dstAn.map((a) => [a.id, a]));
  const versions = new Map<string, Set<number>>();
  const hashes = new Map<string, Set<string>>(); // análise viva (não bloqueada/rejeitada) por insumo
  const drafts = new Map<string, string[]>(); // rascunhos vivos do destino por artigo
  for (const a of dstAn) {
    (versions.get(a.article_id) ?? versions.set(a.article_id, new Set()).get(a.article_id)!).add(a.version);
    if (!['blocked', 'rejected', 'superseded'].includes(a.status)) (hashes.get(a.article_id) ?? hashes.set(a.article_id, new Set()).get(a.article_id)!).add(a.input_hash);
    if (['in_review', 'blocked'].includes(a.status)) (drafts.get(a.article_id) ?? drafts.set(a.article_id, []).get(a.article_id)!).push(a.id);
  }
  const newAnalyses: Row[] = [];
  const supersedeIds = new Set<string>();
  const srcAnalyses = src.all<Row & { id: string; article_id: string; version: number; input_hash: string; status: string }>(
    `SELECT * FROM analyses WHERE is_demo = 0 AND status IN ('in_review','blocked','superseded') AND published_at IS NULL ORDER BY article_id, version`,
  );
  for (const a of srcAnalyses) {
    const article = artMap.get(a.article_id);
    if (!article) continue;
    const existing = anById.get(a.id);
    if (existing) {
      if (a.status === 'superseded' && ['in_review', 'blocked'].includes(existing.status)) supersedeIds.add(existing.id);
      continue;
    }
    if (a.status !== 'superseded' && hashes.get(article)?.has(a.input_hash)) continue; // mesmo trabalho já feito
    let version = a.version;
    if (versions.get(article)?.has(version)) version = maxVersion(versions, article) + 1;
    (versions.get(article) ?? versions.set(article, new Set()).get(article)!).add(version);
    if (a.status === 'in_review' || a.status === 'blocked') {
      // Rascunho novo aposenta os anteriores (mesma regra do reprocessamento); publicadas não mudam.
      for (const old of drafts.get(article) ?? []) supersedeIds.add(old);
      drafts.set(article, []);
      (hashes.get(article) ?? hashes.set(article, new Set()).get(article)!).add(a.input_hash);
    }
    newAnalyses.push({ ...a, article_id: article, version });
  }
  const analysisIds = new Set(newAnalyses.map((a) => a.id as string));
  const childRows = (table: 'evidence_results' | 'claims') => (analysisIds.size
    ? src.all<Row & { analysis_id: string }>(`SELECT * FROM ${table}`).filter((r) => analysisIds.has(r.analysis_id))
    : []);

  // ---- Demais tabelas de conteúdo ----
  const remapArticle = (r: Row) => ({ ...r, article_id: artMap.get(r.article_id as string) });
  const articleSources = src.all<Row & { article_id: string; source_id: string }>('SELECT * FROM article_sources')
    .filter((r) => artMap.has(r.article_id) && sourceMap.has(r.source_id)).map((r) => ({ ...remapArticle(r), source_id: sourceMap.get(r.source_id) }));
  const articleTopics = src.all<Row & { article_id: string; topic_id: string }>('SELECT * FROM article_topics')
    .filter((r) => artMap.has(r.article_id) && topicMap.has(r.topic_id)).map((r) => ({ ...remapArticle(r), topic_id: topicMap.get(r.topic_id) }));
  const corrections = src.all<Row & { article_id: string }>('SELECT * FROM article_corrections').filter((r) => artMap.has(r.article_id)).map(remapArticle);
  const classifications = src.all<Row & { journal_id: string }>('SELECT * FROM journal_classifications')
    .filter((r) => journalMap.has(r.journal_id)).map((r) => ({ ...r, journal_id: journalMap.get(r.journal_id) }));

  const dstDocs = new Map(dst.all<{ id: string; payload: string }>('SELECT id, payload FROM monitored_documents').map((d) => [d.id, d.payload]));
  const docs = src.all<Row & { id: string; payload: string }>('SELECT * FROM monitored_documents').filter((d) => dstDocs.get(d.id) !== d.payload);
  const dstSync = new Map(dst.all<{ source: string; last_success_at: string | null }>('SELECT source, last_success_at FROM monitor_sync').map((s) => [s.source, s.last_success_at ?? '']));
  const syncs = src.all<Row & { source: string; last_success_at: string | null }>('SELECT * FROM monitor_sync WHERE last_success_at IS NOT NULL')
    .filter((s) => (s.last_success_at ?? '') > (dstSync.get(s.source) ?? ''));

  // ---- Escrita: uma transação só; se falhar, nada é aplicado e o próximo deploy tenta de novo ----
  dst.tx(() => {
    insertIgnore(dst, 'journals', newJournals);
    res.articles = insertIgnore(dst, 'articles', newArticles);
    for (const u of updates) { dst.run(`UPDATE articles SET ${u.set}, updated_at = ? WHERE id = ?`, ...u.params, new Date().toISOString(), u.id); res.articlesUpdated++; }
    res.articleSources = insertIgnore(dst, 'article_sources', articleSources);
    insertIgnore(dst, 'article_topics', articleTopics);
    for (const id of supersedeIds) res.superseded += Number(dst.run("UPDATE analyses SET status = 'superseded' WHERE id = ? AND status IN ('in_review','blocked')", id).changes);
    res.analyses = insertIgnore(dst, 'analyses', newAnalyses);
    insertIgnore(dst, 'evidence_results', childRows('evidence_results'));
    insertIgnore(dst, 'claims', childRows('claims'));
    insertIgnore(dst, 'journal_classifications', classifications);
    insertIgnore(dst, 'article_corrections', corrections);
    for (let i = 0; i < docs.length; i += BATCH) {
      const chunk = docs.slice(i, i + BATCH);
      dst.run(
        `INSERT INTO monitored_documents (id, source, kind, payload, retrieved_at) VALUES ${chunk.map(() => '(?,?,?,?,?)').join(',')}
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, retrieved_at = excluded.retrieved_at`,
        ...(chunk.flatMap((d) => [d.id, d.source, d.kind, d.payload, d.retrieved_at]) as Params),
      );
    }
    res.documents = docs.length;
    for (const s of syncs) dst.run('INSERT INTO monitor_sync (source, last_success_at, last_error) VALUES (?,?,NULL) ON CONFLICT(source) DO UPDATE SET last_success_at = excluded.last_success_at, last_error = NULL', s.source, s.last_success_at);
  });
  return res;
}
