// Fluxo editorial: fila, decisão humana auditada, composição e publicação de edições.
import type { AiAnalysis } from '@jm/contracts';
import type { Db, Row } from '../db/index.ts';
import { json } from '../db/index.ts';
import { AppError, id, nowIso } from '../lib/util.ts';
import { audit } from './audit.ts';
import { rankBest } from './grade.ts';
import { resultRow } from './content.ts';
import { buildDocument } from '../ai/analysis.ts';
import { validateEditorial } from '../ai/validator.ts';

export function reviewQueue(db: Db, status?: string) {
  const statuses = status ? [status] : ['in_review', 'blocked'];
  return db.all(
    `SELECT a.id, a.version, a.status, a.model, a.prompt_version, a.input_scope, a.created_at, a.validation, a.is_demo, a.editorial_priority,
            json_extract(a.payload, '$.editorialHeadline') AS headline, json_extract(a.payload, '$.reviewFlags') AS flags,
            ar.original_title, ar.slug, ar.pmid, ar.doi, ar.retraction_status
       FROM analyses a JOIN articles ar ON ar.id = a.article_id
      WHERE a.status IN (${statuses.map(() => '?').join(',')}) ORDER BY a.created_at DESC LIMIT 200`,
    ...statuses,
  ).map((r) => ({ ...r, validation: json(r.validation, []), flags: json(r.flags, []) }));
}

export function reviewDetail(db: Db, analysisId: string) {
  const a = db.get('SELECT * FROM analyses WHERE id = ?', analysisId);
  if (!a) throw new AppError(404, 'not_found', 'Análise não encontrada.');
  const article = db.get('SELECT ar.*, j.title AS journal FROM articles ar LEFT JOIN journals j ON j.id = ar.journal_id WHERE ar.id = ?', a.article_id as string)!;
  return {
    analysis: { ...a, payload: json<AiAnalysis>(a.payload, {} as AiAnalysis), validation: json(a.validation, []) },
    results: db.all('SELECT * FROM evidence_results WHERE analysis_id = ? ORDER BY ord', analysisId),
    claims: db.all('SELECT * FROM claims WHERE analysis_id = ? ORDER BY ord', analysisId),
    article: { ...article, authors: json(article.authors, []), publication_types: json(article.publication_types, []) },
    // Material de origem para comparação lado a lado (uso interno/editorial).
    sources: db.all('SELECT external_id, retrieved_at, license, abstract_text, content_hash FROM article_sources WHERE article_id = ?', a.article_id as string),
    reviews: db.all(
      'SELECT r.decision, r.justification, r.edits, r.created_at, u.email AS reviewer FROM editorial_reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.analysis_id = ? ORDER BY r.created_at',
      analysisId,
    ),
    versions: db.all('SELECT id, version, status, created_at, published_at FROM analyses WHERE article_id = ? ORDER BY version', a.article_id as string),
  };
}

export function decide(
  db: Db,
  reviewer: { id: string; role: string },
  analysisId: string,
  input: { decision: 'approve' | 'reject' | 'request_changes'; justification: string; overrideBlocked?: boolean; edits?: { editorialHeadline?: string; summary?: string; inShort?: string } },
) {
  if (reviewer.role !== 'editor' && reviewer.role !== 'admin') throw new AppError(403, 'forbidden', 'Apenas editores podem revisar.');
  return db.tx(() => {
    const a = db.get('SELECT a.*, ar.retraction_status FROM analyses a JOIN articles ar ON ar.id = a.article_id WHERE a.id = ?', analysisId);
    if (!a) throw new AppError(404, 'not_found', 'Análise não encontrada.');
    if (!['in_review', 'blocked'].includes(a.status as string)) throw new AppError(409, 'not_reviewable', `Análise em estado '${a.status}' não pode ser revisada.`);
    if (input.decision === 'approve' && a.retraction_status === 'retracted') throw new AppError(409, 'retracted', 'Artigo retratado não pode ser publicado.');
    const now = nowIso();
    if (input.decision === 'approve') {
      let payload: AiAnalysis;
      try {
        payload = JSON.parse(a.payload as string) as AiAnalysis;
      } catch {
        payload = null as unknown as AiAnalysis;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError(409, 'corrupt_payload', 'Conteúdo da análise corrompido: reprocesse o artigo antes de aprovar.');
      if (a.status === 'blocked' && !(input.overrideBlocked && input.justification.trim().length >= 30)) {
        throw new AppError(409, 'blocked_needs_override', 'Análise bloqueada pelo validador: confirme a liberação (overrideBlocked) com justificativa de 30+ caracteres.');
      }
      if (input.edits) payload = { ...payload, ...input.edits };
      if (a.is_demo !== 1) {
        // A redação final (com as edições) passa pelo mesmo validador da IA: nenhum número fora da extração/fonte.
        const art = db.get<{ original_title: string; journal: string | null; publication_types: string; pub_date: string | null }>(
          'SELECT ar.original_title, j.title AS journal, ar.publication_types, ar.pub_date FROM articles ar LEFT JOIN journals j ON j.id = ar.journal_id WHERE ar.id = ?', a.article_id as string)!;
        const abs = db.get<{ abstract_text: string | null }>('SELECT abstract_text FROM article_sources WHERE article_id = ? ORDER BY retrieved_at DESC LIMIT 1', a.article_id as string)?.abstract_text ?? '';
        const results = db.all('SELECT * FROM evidence_results WHERE analysis_id = ? ORDER BY ord', analysisId).map(resultRow);
        const extractionJson = JSON.stringify({ ...payload, editorialHeadline: null, summary: null, inShort: null, plainResult: null, results });
        const ed = validateEditorial(payload, extractionJson, buildDocument(art, abs));
        if (ed.errors.length) throw new AppError(409, 'editorial_invalid', `Redação reprovada pelo validador: ${ed.errors.join('; ').slice(0, 400)}`);
      }
      // Versões anteriores publicadas viram 'superseded' (correção versionada e visível).
      const prev = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM analyses WHERE article_id = ? AND status = 'published'", a.article_id as string)!;
      db.run("UPDATE analyses SET status = 'superseded' WHERE article_id = ? AND status = 'published'", a.article_id as string);
      if (prev.n > 0) {
        db.run('INSERT INTO article_corrections (id, article_id, kind, note, created_at) VALUES (?,?,?,?,?)', id(), a.article_id as string, 'correction',
          `Análise atualizada para a versão ${a.version}: ${input.justification}`, now);
      }
      db.run('UPDATE analyses SET status = ?, payload = ?, published_at = ? WHERE id = ?', a.is_demo === 1 ? 'demo' : 'published', JSON.stringify(payload), now, analysisId);
    } else if (input.decision === 'reject') {
      db.run("UPDATE analyses SET status = 'rejected' WHERE id = ?", analysisId);
    }
    db.run(
      'INSERT INTO editorial_reviews (id, analysis_id, reviewer_id, decision, justification, edits, created_at) VALUES (?,?,?,?,?,?,?)',
      id(), analysisId, reviewer.id, input.decision, input.justification, input.edits ? JSON.stringify(input.edits) : null, now,
    );
    audit(db, reviewer.id, `review.${input.decision}`, 'analysis', analysisId, { edited: !!input.edits });
    return { status: input.decision };
  });
}

// ponytail: fuso editorial fixo de São Paulo (UTC-3, sem horário de verão desde 2019); trocar por Intl se mudar.
/** Fim do dia editorial (São Paulo) em UTC: análises publicadas depois disso não entram numa edição dessa data. */
export const endOfEditionDay = (date: string) => new Date(`${date}T23:59:59.999-03:00`).toISOString();

/** Compõe rascunho de edição com análises reais publicadas ainda não usadas. Não inventa itens. */
export function composeEdition(db: Db, date: string, opts: { maxItems?: number; windowDays?: number } = {}) {
  const max = opts.maxItems ?? 12;
  const since = new Date(Date.parse(date) - (opts.windowDays ?? 7) * 86_400_000).toISOString();
  return db.tx(() => {
    const all = db.all<{ aid: string; article_id: string; priority: number; topic_parent: string | null }>(
      `SELECT a.id AS aid, a.article_id, a.editorial_priority AS priority,
              (SELECT t.parent_id FROM article_topics at JOIN topics t ON t.id = at.topic_id WHERE at.article_id = a.article_id ORDER BY at.confidence DESC LIMIT 1) AS topic_parent
         FROM analyses a JOIN articles ar ON ar.id = a.article_id
        WHERE a.status = 'published' AND a.is_demo = 0 AND ar.retraction_status <> 'retracted' AND a.published_at >= ? AND a.published_at <= ?
          AND NOT EXISTS (SELECT 1 FROM edition_items i JOIN editions e ON e.id = i.edition_id
                           WHERE i.article_id = a.article_id AND e.status = 'published' AND e.is_demo = 0 AND e.edition_date <> ?)
        ORDER BY a.published_at DESC LIMIT 300`,
      since, endOfEditionDay(date), date,
    );
    // Manchete = estudo mais bem avaliado; depois os seguintes na mesma ordem (ver modules/grade.ts).
    const order = new Map(rankBest(db, all.map((r) => r.aid)).map((a, i) => [a, i]));
    const rows = all.sort((a, b) => order.get(a.aid)! - order.get(b.aid)!).slice(0, max);
    const version = db.get<{ v: number }>('SELECT COALESCE(MAX(version),0)+1 AS v FROM editions WHERE edition_date = ? AND is_demo = 0', date)!.v;
    const number = db.get<{ n: number }>("SELECT COUNT(DISTINCT edition_date) + 1 AS n FROM editions WHERE is_demo = 0 AND status = 'published' AND edition_date < ?", date)!.n;
    const eid = id();
    db.run(
      `INSERT INTO editions (id, edition_date, version, number, status, is_demo, coverage_note, composed_at) VALUES (?,?,?,?, 'draft', 0, ?, ?)`,
      eid, date, version, number, rows.length ? null : 'Sem estudos elegíveis aprovados para esta data.', nowIso(),
    );
    rows.forEach((r, i) => {
      const slot = i === 0 ? 'headline' : i <= 3 ? 'secondary' : 'section';
      db.run('INSERT INTO edition_items (edition_id, analysis_id, article_id, slot, section_topic_id, position) VALUES (?,?,?,?,?,?)', eid, r.aid, r.article_id, slot, r.topic_parent, i);
    });
    return { editionId: eid, version, items: rows.length };
  });
}

export function publishEdition(db: Db, user: { id: string; role: string }, date: string) {
  if (user.role !== 'editor' && user.role !== 'admin') throw new AppError(403, 'forbidden', 'Apenas editores publicam edições.');
  return db.tx(() => {
    const draft = db.get<Row>("SELECT * FROM editions WHERE edition_date = ? AND status = 'draft' AND is_demo = 0 ORDER BY version DESC LIMIT 1", date);
    if (!draft) throw new AppError(404, 'no_draft', 'Não há rascunho para esta data. Componha a edição primeiro.');
    const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM edition_items WHERE edition_id = ?', draft.id as string)!.n;
    if (n === 0) throw new AppError(409, 'empty_edition', 'Edição sem itens aprovados não é publicada.');
    // Só itens com análise publicada (aprovada por humano) podem sair.
    const unapproved = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM edition_items i JOIN analyses a ON a.id = i.analysis_id WHERE i.edition_id = ? AND a.status <> 'published'", draft.id as string,
    )!.n;
    if (unapproved > 0) throw new AppError(409, 'unapproved_items', 'A edição contém análises sem aprovação editorial.');
    // Retratação pode chegar depois da composição: revalida na hora de publicar.
    const retracted = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM edition_items i JOIN articles ar ON ar.id = i.article_id WHERE i.edition_id = ? AND ar.retraction_status = 'retracted'", draft.id as string,
    )!.n;
    if (retracted > 0) throw new AppError(409, 'retracted_items', 'A edição contém artigo retratado. Recomponha a edição antes de publicar.');
    db.run("UPDATE editions SET status = 'superseded' WHERE edition_date = ? AND status = 'published' AND is_demo = 0", date);
    db.run("UPDATE editions SET status = 'published', published_at = ?, published_by = ? WHERE id = ?", nowIso(), user.id, draft.id as string);
    audit(db, user.id, 'edition.published', 'edition', draft.id as string, { date, items: n });
    return { editionId: draft.id as string, items: n };
  });
}
