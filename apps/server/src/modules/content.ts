// Montagem dos DTOs de leitura (cards, edição, detalhe). Só conteúdo visível ao leitor:
// análises 'published' (reais) ou 'demo', conforme a flag real_content.
import type { AiAnalysis, ArticleCard, ArticleDetail, EditionDto, EditionSummary, EvidenceResultDto, KeyResult } from '@jm/contracts';
import type { Db, Params, Row } from '../db/index.ts';
import { json } from '../db/index.ts';
import { AppError, httpsUrl, localDate } from '../lib/util.ts';
import { flag } from './audit.ts';
import { claimsOf } from './analyses.ts';
import { gradeEvidence, rankBest } from './grade.ts';

/** Filtro SQL de visibilidade para a tabela `analyses` com alias `a`. */
export function visibility(db: Db): { sql: string; params: Params } {
  if (!flag(db, 'real_content')) return { sql: "a.status = 'demo' AND a.is_demo = 1", params: [] };
  // Prévia de IA: inclui análises em revisão (nunca as bloqueadas ou rejeitadas), sempre rotuladas.
  return flag(db, 'ai_preview')
    ? { sql: "a.status IN ('published','in_review') AND a.is_demo = 0", params: [] }
    : { sql: "a.status = 'published' AND a.is_demo = 0", params: [] };
}

/**
 * Uma análise por artigo, sempre a mesma: entre as visíveis, publicada vence rascunho e a maior versão desempata.
 * Use junto com `visibility` (alias `a`).
 */
export function oneVisiblePerArticle(db: Db, v = visibility(db)): { sql: string; params: Params } {
  return {
    sql: `a.id = (SELECT x.id FROM analyses x WHERE x.article_id = a.article_id AND ${v.sql.replace(/\ba\./g, 'x.')}
                  ORDER BY CASE x.status WHEN 'published' THEN 0 ELSE 1 END, x.version DESC LIMIT 1)`,
    params: v.params,
  };
}

const ph = (n: number) => Array(n).fill('?').join(',');
/** "Novo" na capa: analisado pelo ciclo diário nas últimas 36 h (folga para um ciclo atrasado). */
export const FRESH_HOURS = 36;

function countWords(s: string | null | undefined): number {
  if (!s) return 0;
  let words = 0;
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const space = code === 32 || code === 9 || code === 10 || code === 13;
    if (space) inWord = false;
    else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  return words;
}

function readingMinutes(p: Partial<AiAnalysis>): number {
  let words = countWords(p.summary) + countWords(p.context) + countWords(p.objective) + countWords(p.methods) + countWords(p.clinicalImplications);
  if (p.limitations) for (const lim of p.limitations) words += countWords(lim);
  return Math.max(1, Math.round(words / 200 + 1));
}

// Cache puro de JSON.parse + tempo de leitura indexado pela string exata do payload (sem cache de linhas do banco).
const parsedPayloads = new Map<string, { payload: Partial<AiAnalysis>; minutes: number }>();
function parseAnalysisPayload(raw: unknown): { payload: Partial<AiAnalysis>; minutes: number } {
  if (typeof raw !== 'string') return { payload: {}, minutes: 1 };
  const cached = parsedPayloads.get(raw);
  if (cached) {
    parsedPayloads.delete(raw);
    parsedPayloads.set(raw, cached);
    return cached;
  }
  const payload = json<Partial<AiAnalysis>>(raw, {});
  const entry = { payload, minutes: readingMinutes(payload) };
  if (parsedPayloads.size >= 256) parsedPayloads.delete(parsedPayloads.keys().next().value!);
  parsedPayloads.set(raw, entry);
  return entry;
}

export function resultRow(r: Row): EvidenceResultDto {
  return {
    id: r.id as string,
    outcome: r.outcome as string,
    outcomeType: r.outcome_type as EvidenceResultDto['outcomeType'],
    measure: r.measure as string | null,
    measureKind: r.measure_kind as EvidenceResultDto['measureKind'],
    estimate: r.estimate as number | null,
    estimateRaw: r.estimate_raw as string | null,
    unit: r.unit as string | null,
    comparator: r.comparator as string | null,
    population: r.population as string | null,
    timepoint: r.timepoint as string | null,
    confidenceInterval: r.ci_level != null && r.ci_lower != null && r.ci_upper != null
      ? { level: r.ci_level as number, lower: r.ci_lower as number, upper: r.ci_upper as number, raw: (r.ci_raw as string) ?? '' } : null,
    pValue: r.p_raw != null ? { raw: r.p_raw as string, operator: r.p_operator as '=', value: r.p_value as number } : null,
    sampleSize: r.sample_size as number | null,
    adjusted: r.adjusted == null ? null : r.adjusted === 1,
    evidenceRef: { locator: r.evidence_locator as EvidenceResultDto['evidenceRef']['locator'], quote: r.evidence_quote as string | null },
    missingReason: r.missing_reason as string | null,
  };
}

/** Cards na ordem dos IDs de análise recebidos. */
export function cards(db: Db, analysisIds: string[], userId?: string | null): ArticleCard[] {
  const m = cardMap(db, analysisIds, userId);
  return analysisIds.map((a) => m.get(a)).filter((c): c is ArticleCard => !!c);
}

export function cardMap(db: Db, analysisIds: string[], userId?: string | null, currentRecommendations = false): Map<string, ArticleCard> {
  if (!analysisIds.length) return new Map();
  const current = currentRecommendations ? oneVisiblePerArticle(db) : null;
  const rows = db.all(
    `SELECT a.id AS aid, a.payload, a.status, a.is_demo, ar.id, ar.slug, ar.original_title, ar.publication_types, ar.pub_date,
            ar.retraction_status, ar.access_status, ar.journal_id, j.title AS journal, s.name AS source_name
       FROM analyses a JOIN articles ar ON ar.id = a.article_id
       LEFT JOIN journals j ON j.id = ar.journal_id JOIN sources s ON s.id = ar.source_id
      WHERE a.id IN (${ph(analysisIds.length)})
        ${current ? `AND (${current.sql}) AND ar.retraction_status <> 'retracted'` : ''}`,
    ...analysisIds, ...(current?.params ?? []),
  );
  if (!rows.length) return new Map();
  const articleIds = rows.map((r) => r.id as string);
  const foundAnalysisIds = rows.map((r) => r.aid as string);
  const correctedArticles = new Set(
    db.all<{ article_id: string }>(
      `SELECT DISTINCT article_id FROM article_corrections WHERE kind = 'correction' AND article_id IN (${ph(articleIds.length)})`,
      ...articleIds,
    ).map((r) => r.article_id),
  );
  const topics = db.all(
    `SELECT at.article_id, t.slug, t.label_pt, COALESCE(t.color, p.color, pp.color) AS color
       FROM article_topics at JOIN topics t ON t.id = at.topic_id
       LEFT JOIN topics p ON p.id = t.parent_id LEFT JOIN topics pp ON pp.id = p.parent_id
      WHERE at.article_id IN (${ph(articleIds.length)}) ORDER BY t.sort`,
    ...articleIds,
  );
  const topicsByArticle = new Map<string, { slug: string; label: string; color: string | null }[]>();
  for (const t of topics) {
    const aid = t.article_id as string;
    const item = { slug: t.slug as string, label: t.label_pt as string, color: t.color as string | null };
    const list = topicsByArticle.get(aid);
    if (list) list.push(item);
    else topicsByArticle.set(aid, [item]);
  }
  const keyResults = db.all(
    `SELECT * FROM evidence_results WHERE analysis_id IN (${ph(foundAnalysisIds.length)})
      ORDER BY analysis_id, (estimate IS NULL), CASE outcome_type WHEN 'primary' THEN 0 ELSE 1 END, ord`,
    ...foundAnalysisIds,
  );
  const keyByAnalysis = new Map<string, Row>();
  const maxSampleByAnalysis = new Map<string, number>();
  for (const k of keyResults) {
    const aid = k.analysis_id as string;
    if (!keyByAnalysis.has(aid)) keyByAnalysis.set(aid, k);
    if (typeof k.sample_size === 'number') {
      const prev = maxSampleByAnalysis.get(aid);
      if (prev === undefined || k.sample_size > prev) maxSampleByAnalysis.set(aid, k.sample_size);
    }
  }
  const journalIds = [...new Set(rows.map((r) => r.journal_id as string | null).filter((x): x is string => !!x))];
  const qualisByJournal = new Map<string, { stratum: string; cycle: string }>();
  if (journalIds.length) {
    const clsRows = db.all<{ journal_id: string; stratum: string; cycle: string | null }>(
      `SELECT journal_id, stratum, cycle FROM journal_classifications WHERE journal_id IN (${ph(journalIds.length)}) ORDER BY imported_at DESC`,
      ...journalIds,
    );
    for (const c of clsRows) {
      if (!qualisByJournal.has(c.journal_id) && c.stratum) qualisByJournal.set(c.journal_id, { stratum: c.stratum, cycle: c.cycle ?? '' });
    }
  }
  const marks = userId
    ? {
        saved: new Set(db.all<{ article_id: string }>(`SELECT article_id FROM bookmarks WHERE user_id = ? AND article_id IN (${ph(articleIds.length)})`, userId, ...articleIds).map((r) => r.article_id)),
        read: new Set(db.all<{ article_id: string }>(`SELECT DISTINCT article_id FROM read_events WHERE user_id = ? AND article_id IN (${ph(articleIds.length)})`, userId, ...articleIds).map((r) => r.article_id)),
      }
    : null;
  const out = new Map<string, ArticleCard>();
  for (const r of rows) {
    const aid = r.aid as string;
    const { payload: p, minutes } = parseAnalysisPayload(r.payload);
    const kr = keyByAnalysis.get(aid);
    const retraction = r.retraction_status as ArticleCard['retractionStatus'];
    const evidence = gradeEvidence({
      design: p.studyDesign ?? 'unknown',
      sampleSize: p.population?.sampleSize ?? maxSampleByAnalysis.get(aid) ?? null,
      hasPrecision: kr ? kr.ci_lower != null || kr.p_raw != null : false,
      flags: p.reviewFlags ?? [],
      retracted: retraction === 'retracted',
    });
    const key: KeyResult | null = kr
      ? (() => { const x = resultRow(kr); return { plain: p.plainResult ?? null, outcome: x.outcome, measure: x.measure, estimate: x.estimate, estimateRaw: x.estimateRaw, unit: x.unit, ci: x.confidenceInterval, pRaw: x.pValue?.raw ?? null, p: x.pValue ? { operator: x.pValue.operator, value: x.pValue.value } : null, population: (kr.population as string | null) ?? p.population?.description ?? null, intervention: p.interventionOrExposure ?? null, comparator: (kr.comparator as string | null) ?? p.comparator ?? null }; })()
      : null;
    const card: ArticleCard = {
      id: r.id as string,
      slug: r.slug as string,
      headline: p.editorialHeadline ?? (r.original_title as string),
      originalTitle: r.original_title as string,
      inShort: p.inShort ?? null,
      studyDesign: p.studyDesign ?? 'unknown',
      publicationType: json<string[]>(r.publication_types, [])[0] ?? 'Artigo',
      journal: (r.journal as string) ?? null,
      sourceName: r.source_name as string,
      pubDate: (r.pub_date as string) ?? null,
      topics: topicsByArticle.get(r.id as string) ?? [],
      isDemo: r.is_demo === 1,
      retractionStatus: retraction,
      accessStatus: r.access_status as string,
      keyResult: key,
      evidence,
      journalQualis: r.journal_id ? qualisByJournal.get(r.journal_id as string) ?? null : null,
      readingMinutes: minutes,
      reviewStatus: retraction === 'retracted' ? 'retracted' : r.status === 'in_review' ? 'ai_unreviewed' : correctedArticles.has(r.id as string) ? 'corrected' : r.is_demo === 1 ? 'demo' : 'reviewed',
    };
    if (marks) {
      card.bookmarked = marks.saved.has(card.id);
      card.read = marks.read.has(card.id);
    }
    out.set(aid, card);
  }
  return out;
}

/** Última análise visível por artigo. */
export function visibleAnalysisIdsForArticles(db: Db, articleIds: string[]): Map<string, string> {
  if (!articleIds.length) return new Map();
  const v = visibility(db);
  const one = oneVisiblePerArticle(db, v);
  const rows = db.all<{ article_id: string; id: string }>(
    `SELECT a.article_id, a.id FROM analyses a WHERE ${v.sql} AND a.article_id IN (${ph(articleIds.length)}) AND ${one.sql}`,
    ...v.params, ...articleIds, ...one.params,
  );
  return new Map(rows.map((r) => [r.article_id, r.id]));
}

export function editionDto(db: Db, edition: Row, userId?: string | null, preloadedCards?: Map<string, ArticleCard>): EditionDto {
  const items = db.all<{ analysis_id: string; slot: string; section_topic_id: string | null; position: number }>(
    'SELECT analysis_id, slot, section_topic_id, position FROM edition_items WHERE edition_id = ? ORDER BY position', edition.id as string,
  );
  const missingIds = preloadedCards ? items.map((i) => i.analysis_id).filter((id) => !preloadedCards.has(id)) : items.map((i) => i.analysis_id);
  const fetched = missingIds.length ? cardMap(db, missingIds, userId) : new Map<string, ArticleCard>();
  const byAnalysis = new Map<string, ArticleCard>();
  for (const it of items) {
    const c = preloadedCards?.get(it.analysis_id) ?? fetched.get(it.analysis_id);
    if (c) byAnalysis.set(it.analysis_id, c);
  }
  const all = [...byAnalysis.values()];
  const headlineItem = items.find((i) => i.slot === 'headline');
  const secondary = items.filter((i) => i.slot === 'secondary').map((i) => byAnalysis.get(i.analysis_id)).filter((c): c is ArticleCard => !!c);
  const sectionMap = new Map<string, ArticleCard[]>();
  for (const it of items.filter((i) => i.slot === 'section')) {
    const c = byAnalysis.get(it.analysis_id);
    if (!c) continue;
    const key = it.section_topic_id ?? 'geral';
    sectionMap.set(key, [...(sectionMap.get(key) ?? []), c]);
  }
  const topicIds = [...sectionMap.keys()];
  const topics = topicIds.length ? db.all<{ id: string; slug: string; label_pt: string; color: string | null }>(
    `SELECT id, slug, label_pt, color FROM topics WHERE id IN (${ph(topicIds.length)})`, ...topicIds,
  ) : [];
  const byTopic = new Map(topics.map((t) => [t.id, t]));
  const sections = [...sectionMap.entries()].map(([topicId, list]) => {
    const t = byTopic.get(topicId);
    return { topic: { slug: t?.slug ?? 'geral', label: t?.label_pt ?? 'Geral', color: t?.color ?? null }, items: list };
  });
  const headline = headlineItem ? byAnalysis.get(headlineItem.analysis_id) ?? null : null;
  return {
    id: edition.id as string,
    date: edition.edition_date as string,
    number: edition.number as number,
    version: edition.version as number,
    publishedAt: (edition.published_at as string) ?? null,
    isDemo: edition.is_demo === 1,
    coverageNote: (edition.coverage_note as string) ?? null,
    headline,
    secondary,
    sections,
    forYou: [],
    totalReadingMinutes: all.reduce((s, c) => s + c.readingMinutes, 0),
  };
}

export function publishedEdition(db: Db, date?: string): Row | undefined {
  const demo = flag(db, 'real_content') ? 0 : 1;
  return date
    ? db.get("SELECT * FROM editions WHERE edition_date = ? AND status = 'published' AND is_demo = ? ORDER BY version DESC LIMIT 1", date, demo)
    : db.get("SELECT * FROM editions WHERE status = 'published' AND is_demo = ? ORDER BY edition_date DESC, version DESC LIMIT 1", demo);
}

export function editionList(db: Db, limit = 60): EditionSummary[] {
  const demo = flag(db, 'real_content') ? 0 : 1;
  return db.all(
    `SELECT e.edition_date, e.number, e.is_demo, COUNT(i.article_id) AS items,
            (SELECT json_extract(a.payload, '$.editorialHeadline') FROM edition_items h JOIN analyses a ON a.id = h.analysis_id
              WHERE h.edition_id = e.id AND h.slot = 'headline') AS headline
       FROM editions e LEFT JOIN edition_items i ON i.edition_id = e.id
      WHERE e.status = 'published' AND e.is_demo = ? AND e.version = (SELECT MAX(version) FROM editions x WHERE x.edition_date = e.edition_date AND x.status = 'published' AND x.is_demo = e.is_demo)
      GROUP BY e.id ORDER BY e.edition_date DESC LIMIT ?`,
    demo, limit,
  ).map((r) => ({ date: r.edition_date as string, number: r.number as number, isDemo: r.is_demo === 1, headline: (r.headline as string) ?? null, items: r.items as number }));
}

export function articleDetail(db: Db, slug: string, opts: { userId?: string | null; entitled: boolean; staff?: boolean }): ArticleDetail {
  const art = db.get('SELECT ar.*, j.title AS journal_title, j.id AS jid FROM articles ar LEFT JOIN journals j ON j.id = ar.journal_id WHERE ar.slug = ?', slug);
  if (!art) throw new AppError(404, 'not_found', 'Artigo não encontrado.');
  const aid = visibleAnalysisIdsForArticles(db, [art.id as string]).get(art.id as string);
  if (!aid) throw new AppError(404, 'not_found', 'Artigo não encontrado.');
  const card = cards(db, [aid], opts.userId)[0]!;
  const an = db.get('SELECT payload, created_at, published_at, is_demo, version, prompt_version, model FROM analyses WHERE id = ?', aid)!;
  const payload = parseAnalysisPayload(an.payload).payload as AiAnalysis;
  const review = db.get<{ created_at: string }>("SELECT created_at FROM editorial_reviews WHERE analysis_id = ? AND decision = 'approve' ORDER BY created_at DESC LIMIT 1", aid);


  const cls = db.get<{ system: string; stratum: string; cycle: string; source_url: string }>(
    'SELECT system, stratum, cycle, source_url FROM journal_classifications WHERE journal_id = ? ORDER BY imported_at DESC LIMIT 1', (art.jid as string) ?? '',
  );
  const locked = !opts.entitled && !opts.staff;
  return {
    ...card,
    authors: json<string[]>(art.authors, []),
    doi: (art.doi as string) ?? null,
    pmid: (art.pmid as string) ?? null,
    pmcid: (art.pmcid as string) ?? null,
    canonicalUrl: httpsUrl(art.canonical_url as string | null),
    processedAt: an.created_at as string,
    reviewedAt: review?.created_at ?? (an.is_demo === 1 ? null : (an.published_at as string) ?? null),
    reviewerLabel: review ? 'Editor responsável (identidade registrada internamente)' : null,
    analysisVersion: an.version as number,
    promptVersion: an.prompt_version as string,
    model: an.model as string,
    locked,
    journalClassification: cls ? { system: cls.system, stratum: cls.stratum, cycle: cls.cycle, sourceUrl: cls.source_url } : null,
    summary: payload.summary ?? null,
    analysis: locked ? null : {
      ...payload,
      results: db.all('SELECT * FROM evidence_results WHERE analysis_id = ? ORDER BY ord', aid).map(resultRow),
      claims: claimsOf(db, aid),
    },
    corrections: db.all<{ created_at: string; note: string }>('SELECT created_at, note FROM article_corrections WHERE article_id = ? ORDER BY created_at', art.id as string)
      .map((c) => ({ date: c.created_at, note: c.note })),
  };
}

/** Prévia de edição montada na hora (não gravada nem publicada) com as análises reais visíveis mais recentes. */
export function previewEdition(db: Db, userId: string | null, today: string): EditionDto | null {
  const v = visibility(db);
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const rows = db.all<{ aid: string; section: string | null; created_at: string }>(
    `SELECT a.id AS aid, a.created_at,
            (SELECT CASE WHEN t.level = 'tema' THEN t.parent_id ELSE t.id END FROM article_topics at JOIN topics t ON t.id = at.topic_id
              WHERE at.article_id = a.article_id ORDER BY at.confidence DESC LIMIT 1) AS section
       FROM analyses a JOIN articles ar ON ar.id = a.article_id
      WHERE ${v.sql} AND ar.retraction_status <> 'retracted' AND a.created_at >= ?
        AND ${oneVisiblePerArticle(db).sql}
      ORDER BY a.created_at DESC LIMIT 300`,
    ...v.params, since, ...oneVisiblePerArticle(db).params,
  );
  if (!rows.length) return null;
  // Capa do dia: primeiro o que o ciclo diário trouxe nas últimas 36 h, depois o restante dos 14 dias.
  // Dentro de cada grupo, os mais bem avaliados (força da evidência, depois Qualis, depois prioridade editorial).
  const freshSince = new Date(Date.now() - FRESH_HOURS * 3_600_000).toISOString();
  const fresh = new Set(rows.filter((r) => r.created_at >= freshSince).map((r) => r.aid));
  const ranked = rankBest(db, rows.map((r) => r.aid));
  const best = new Map([...ranked.filter((a) => fresh.has(a)), ...ranked.filter((a) => !fresh.has(a))].slice(0, 30).map((a, i) => [a, i]));
  const top = rows.filter((r) => best.has(r.aid)).sort((a, b) => best.get(a.aid)! - best.get(b.aid)!);
  const m = cardMap(db, top.map((r) => r.aid), userId);
  const all = top.map((r) => m.get(r.aid)).filter((c): c is ArticleCard => !!c);
  const sectionMap = new Map<string, ArticleCard[]>();
  top.slice(4).forEach((r) => {
    const c = m.get(r.aid);
    if (c) sectionMap.set(r.section ?? 'geral', [...(sectionMap.get(r.section ?? 'geral') ?? []), c]);
  });
  const sections = [...sectionMap.entries()].map(([topicId, items]) => {
    const t = db.get<{ slug: string; label_pt: string; color: string | null }>(
      'SELECT t.slug, t.label_pt, COALESCE(t.color, p.color) AS color FROM topics t LEFT JOIN topics p ON p.id = t.parent_id WHERE t.id = ?', topicId,
    );
    return { topic: { slug: t?.slug ?? 'geral', label: t?.label_pt ?? 'Geral', color: t?.color ?? null }, items };
  }).sort((a, b) => b.items.length - a.items.length);
  return {
    id: `preview-${today}`, date: today, number: 0, version: 1, publishedAt: null, isDemo: false, isPreview: true,
    coverageNote: 'Prévia automática: análises de IA ainda sem revisão editorial.',
    freshCount: fresh.size,
    // Estudos analisados hoje (fuso de Brasília): o número objetivo do dia para a linha da edição.
    todayCount: rows.filter((r) => localDate('America/Sao_Paulo', new Date(r.created_at)) === localDate('America/Sao_Paulo')).length,
    headline: all[0] ?? null, secondary: all.slice(1, 4), sections, forYou: [],
    totalReadingMinutes: all.reduce((s, c) => s + c.readingMinutes, 0),
  };
}
