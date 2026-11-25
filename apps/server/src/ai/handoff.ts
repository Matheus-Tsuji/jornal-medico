// Análise "por entrega de arquivo": quem escreve a extração e a redação (ex.: o Claude da rotina diária) trabalha
// fora do servidor, sem chave de API. O servidor continua dono de tudo que importa:
//   claude-export → monta os mesmos <documento> do pipeline, com os mesmos prompts (extraction/editorial);
//   claude-import → revalida schema + validador determinístico + redação e grava SEMPRE como rascunho
//                   ('in_review' ou 'blocked'). Nunca publica: publicar exige editorial_reviews 'approve'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiAnalysisSchema } from '@jm/contracts';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { REPO_ROOT, json } from '../db/index.ts';
import { sha256 } from '../lib/util.ts';
import { alreadyAnalyzed, finalizeAnalysis } from '../modules/analyses.ts';
import { PROMPT_VERSION, buildDocument, editorialSchema } from './analysis.ts';

export const HANDOFF_MODEL = 'claude-rotina-diaria';
const PROMPTS = join(REPO_ROOT, 'apps/server/src/ai/prompts');

/** inputHash e promptVersion vão e voltam: a importação recusa resposta feita sobre um documento ou prompt que mudou. */
export interface HandoffItem { articleId: string; inputHash: string; promptVersion: string; document: string; pubTypes: string[]; pubDate: string | null; topics: string[] }

export const importItemSchema = z.strictObject({
  articleId: z.string().min(1),
  inputHash: z.string().min(1),
  promptVersion: z.string().min(1),
  extraction: aiAnalysisSchema,
  editorial: editorialSchema,
});
export type ImportItem = z.infer<typeof importItemSchema>;

interface ArtRow { original_title: string; journal: string | null; publication_types: string; pub_date: string | null; retraction_status: string; triage_status: string }

function load(db: Db, articleId: string): { error: string } | { error?: undefined; art: ArtRow; document: string; inputHash: string } {
  const art = db.get<ArtRow>(
    'SELECT ar.original_title, j.title AS journal, ar.publication_types, ar.pub_date, ar.retraction_status, ar.triage_status FROM articles ar LEFT JOIN journals j ON j.id = ar.journal_id WHERE ar.id = ?', articleId,
  );
  if (!art) return { error: 'Artigo inexistente.' as const };
  if (art.retraction_status === 'retracted') return { error: 'Artigo retratado: não analisado.' as const };
  if (art.triage_status === 'excluded') return { error: 'Artigo excluído na triagem.' as const };
  const abstract = db.get<{ abstract_text: string | null }>('SELECT abstract_text FROM article_sources WHERE article_id = ? ORDER BY retrieved_at DESC LIMIT 1', articleId)?.abstract_text;
  if (!abstract) return { error: 'Sem abstract autorizado: apenas metadados.' as const };
  const document = buildDocument(art, abstract);
  const inputHash = sha256(`${PROMPT_VERSION}\n${document}`);
  return { error: undefined, art, document, inputHash };
}

/** Artigos elegíveis ainda sem análise para o prompt atual, melhor evidência primeiro. */
export function exportPending(db: Db, limit: number): { promptVersion: string; instructions: Record<string, string>; items: HandoffItem[] } {
  const pending: HandoffItem[] = [];
  const batchSize = 50;
  for (let offset = 0; pending.length < limit; offset += batchSize) {
    const rows = db.all<{ id: string; has_current_prompt: number }>(
      `SELECT ar.id,
              EXISTS (SELECT 1 FROM analyses a WHERE a.article_id = ar.id AND a.prompt_version = ?) AS has_current_prompt
       FROM articles ar
       WHERE ar.triage_status <> 'excluded' AND ar.retraction_status <> 'retracted'
         AND NOT EXISTS (SELECT 1 FROM analyses a WHERE a.article_id = ar.id AND a.is_demo = 1)
         AND EXISTS (SELECT 1 FROM article_sources s WHERE s.article_id = ar.id AND s.abstract_text IS NOT NULL AND s.abstract_text <> '')
       ORDER BY CASE
         WHEN EXISTS (SELECT 1 FROM json_each(ar.publication_types) WHERE instr(value, 'Meta-Analysis') OR instr(value, 'Systematic Review')) THEN 30
         WHEN EXISTS (SELECT 1 FROM json_each(ar.publication_types) WHERE instr(value, 'Randomized Controlled Trial') OR instr(value, 'Guideline') OR instr(value, 'Phase III')) THEN 20
         ELSE 10 END DESC,
         COALESCE(ar.pub_date, '') DESC, ar.id ASC
       LIMIT ? OFFSET ?`,
      PROMPT_VERSION, batchSize, offset,
    );
    for (const { id: articleId, has_current_prompt } of rows) {
      const l = load(db, articleId);
      if (l.error !== undefined) continue;
      // O mesmo prompt pode ter analisado um abstract anterior. Só o hash exato dispensa uma nova análise.
      if (has_current_prompt && alreadyAnalyzed(db, articleId, l.inputHash)) continue;
      const pubTypes = json<string[]>(l.art.publication_types, []);
      const topics = db.all<{ label_pt: string }>("SELECT t.label_pt FROM article_topics at JOIN topics t ON t.id = at.topic_id WHERE at.article_id = ? AND at.method = 'source_query'", articleId).map((t) => t.label_pt);
      pending.push({ articleId, inputHash: l.inputHash, promptVersion: PROMPT_VERSION, document: l.document, pubTypes, pubDate: l.art.pub_date, topics });
      if (pending.length === limit) break;
    }
    if (rows.length < batchSize) break;
  }
  return {
    promptVersion: PROMPT_VERSION,
    instructions: {
      extraction: readFileSync(join(PROMPTS, 'extraction.v2.md'), 'utf8'),
      editorial: readFileSync(join(PROMPTS, 'editorial.v3.md'), 'utf8'),
    },
    items: pending,
  };
}

export type ImportStatus = 'in_review' | 'blocked' | 'skipped_existing' | 'rejected';
export interface ImportResult { articleId: string; status: ImportStatus; detail: string[] }

/** Revalida e grava. A entrada é tratada como não confiável: nada vai ao banco sem passar pelos mesmos validadores. */
export function importAnalyses(db: Db, raw: unknown): ImportResult[] {
  const list = z.array(z.unknown()).parse(raw);
  return list.map((entry): ImportResult => {
    const articleId = (entry as { articleId?: unknown })?.articleId;
    const id = typeof articleId === 'string' ? articleId : '?';
    const parsed = importItemSchema.safeParse(entry);
    if (!parsed.success) return { articleId: id, status: 'rejected', detail: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) };
    const { extraction, editorial } = parsed.data;
    const l = load(db, parsed.data.articleId);
    if (l.error !== undefined) return { articleId: id, status: 'rejected', detail: [l.error] };
    if (parsed.data.promptVersion !== PROMPT_VERSION || parsed.data.inputHash !== l.inputHash) {
      return { articleId: id, status: 'rejected', detail: ['Resposta obsoleta: o documento ou o prompt mudou desde o claude-export. Exporte de novo.'] };
    }
    // Importar de novo é uma nova tentativa explícita: análise bloqueada/rejeitada do mesmo insumo não impede a versão corrigida
    // (o histórico fica; o rascunho novo aposenta o anterior). Só análise viva (em revisão/publicada) conta como "já existe".
    if (alreadyAnalyzed(db, id, l.inputHash, true)) return { articleId: id, status: 'skipped_existing', detail: [] };
    const r = finalizeAnalysis(db, id, extraction, editorial, l.document, { model: HANDOFF_MODEL, promptVersion: PROMPT_VERSION, inputHash: l.inputHash });
    return { articleId: id, status: r.status, detail: r.detail };
  });
}
