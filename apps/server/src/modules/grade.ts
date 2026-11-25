// Força da evidência (A1 a C3) e Qualis da revista: regras explicáveis, sem IA e sem dados novos.
// Letra = desenho do estudo; número = precisão do resultado, tamanho da amostra e sinais de incerteza.
// O periódico NÃO entra na nota do estudo (regra 8 do prompt de extração); o Qualis só desempata a ordem.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiAnalysis, EvidenceGrade, StudyDesign } from '@jm/contracts';
import type { Db } from '../db/index.ts';
import { REPO_ROOT, json } from '../db/index.ts';
import { id, nowIso } from '../lib/util.ts';

interface QualisFile { system: string; cycle: string; sourceUrl: string; journals: { eissn: string; qualisIssn: string | null; stratum: string | null }[] }

/** Liga as revistas do banco ao Qualis consultado (config/qualis-capes-2021-2024.json). Idempotente. */
export function syncQualis(db: Db): number {
  const q = json<QualisFile>(readFileSync(join(REPO_ROOT, 'apps/server/config/qualis-capes-2021-2024.json'), 'utf8'), { system: '', cycle: '', sourceUrl: '', journals: [] });
  let n = 0;
  for (const j of q.journals) {
    if (!j.stratum) continue;
    const issns = [j.eissn, j.qualisIssn].filter(Boolean) as string[];
    const ph = issns.map(() => '?').join(',');
    const rows = db.all<{ id: string }>(`SELECT id FROM journals WHERE eissn IN (${ph}) OR issn IN (${ph})`, ...issns, ...issns);
    for (const r of rows) {
      if (db.get('SELECT 1 FROM journal_classifications WHERE journal_id = ? AND system = ? AND cycle = ?', r.id, q.system, q.cycle)) continue;
      db.run('INSERT INTO journal_classifications (id, journal_id, system, stratum, cycle, area, source_url, imported_at) VALUES (?,?,?,?,?,?,?,?)',
        id(), r.id, q.system, j.stratum, q.cycle, null, q.sourceUrl, nowIso());
      n++;
    }
  }
  return n;
}

const TIER: Partial<Record<StudyDesign, 'A' | 'B'>> = {
  meta_analysis: 'A', systematic_review: 'A', rct: 'A', cluster_rct: 'A',
  cohort: 'B', case_control: 'B', diagnostic_accuracy: 'B', guideline: 'B', economic_evaluation: 'B',
};
const DESIGN_PT: Record<StudyDesign, string> = {
  meta_analysis: 'Metanálise', systematic_review: 'Revisão sistemática', rct: 'Ensaio clínico randomizado', cluster_rct: 'Ensaio randomizado por conglomerados',
  cohort: 'Coorte', case_control: 'Caso-controle', diagnostic_accuracy: 'Acurácia diagnóstica', guideline: 'Diretriz', economic_evaluation: 'Avaliação econômica',
  cross_sectional: 'Estudo transversal', narrative_review: 'Revisão narrativa', case_report: 'Relato de caso', qualitative: 'Estudo qualitativo',
  other: 'Desenho não classificado', unknown: 'Desenho não identificado',
};
const UNCERTAIN = ['numeric_uncertainty', 'conflicting_data', 'validation_failed'];
const LARGE_SAMPLE = 500;

export interface GradeInput {
  design: StudyDesign;
  sampleSize: number | null;
  hasPrecision: boolean; // resultado principal com IC ou p-valor
  flags: string[];
  retracted: boolean;
}

/** Entrada da nota a partir da análise e do resultado principal. Única montagem, usada por cards e pela ordenação. */
export function gradeInputFor(p: Partial<AiAnalysis>, retracted: boolean, key: Record<string, unknown> | undefined, maxSample: number | null): GradeInput {
  return {
    design: p.studyDesign ?? 'unknown',
    sampleSize: p.population?.sampleSize ?? maxSample ?? null,
    hasPrecision: key ? key.ci_lower != null || key.p_raw != null : false,
    flags: p.reviewFlags ?? [],
    retracted,
  };
}

export function gradeEvidence(i: GradeInput): { grade: EvidenceGrade; reasons: string[] } {
  if (i.retracted) return { grade: 'C3', reasons: ['Publicação retratada'] };
  const tier = TIER[i.design] ?? 'C';
  const reasons = [`${DESIGN_PT[i.design]}${tier === 'A' ? ' (topo da hierarquia de evidência)' : tier === 'B' ? ' (evidência intermediária)' : ' (evidência mais fraca)'}`];
  let pts = 0;
  if (i.hasPrecision) { pts++; reasons.push('Resultado principal com IC ou p-valor'); } else reasons.push('Resultado principal sem IC nem p-valor');
  if (i.sampleSize != null && i.sampleSize >= LARGE_SAMPLE) { pts++; reasons.push(`Amostra de ${i.sampleSize.toLocaleString('pt-BR')} participantes`); } else reasons.push(i.sampleSize == null ? 'Tamanho da amostra não informado' : `Amostra pequena (${i.sampleSize.toLocaleString('pt-BR')})`);
  if (i.flags.some((f) => UNCERTAIN.includes(f))) { pts = Math.max(0, pts - 1); reasons.push('Sinais de incerteza nos números extraídos'); }
  return { grade: `${tier}${3 - pts}` as EvidenceGrade, reasons };
}

export interface Scored { grade: EvidenceGrade; reasons: string[]; qualis: { stratum: string; cycle: string } | null; priority: number }

/** Nota de cada análise (mesmas regras para cards, capa e edição). */
export function scoreAnalyses(db: Db, analysisIds: string[]): Map<string, Scored> {
  if (!analysisIds.length) return new Map();
  const ph = analysisIds.map(() => '?').join(',');
  const rows = db.all<{ aid: string; payload: string; priority: number; retraction_status: string; stratum: string | null; cycle: string | null; precise: number; n_max: number | null }>(
    `SELECT a.id AS aid, a.payload, a.editorial_priority AS priority, ar.retraction_status,
            (SELECT c.stratum FROM journal_classifications c WHERE c.journal_id = ar.journal_id AND c.stratum <> '' ORDER BY c.imported_at DESC LIMIT 1) AS stratum,
            (SELECT c.cycle FROM journal_classifications c WHERE c.journal_id = ar.journal_id AND c.stratum <> '' ORDER BY c.imported_at DESC LIMIT 1) AS cycle,
            (SELECT (r.ci_lower IS NOT NULL OR r.p_raw IS NOT NULL) FROM evidence_results r WHERE r.analysis_id = a.id
              ORDER BY (r.estimate IS NULL), CASE r.outcome_type WHEN 'primary' THEN 0 ELSE 1 END, r.ord LIMIT 1) AS precise,
            (SELECT MAX(r.sample_size) FROM evidence_results r WHERE r.analysis_id = a.id) AS n_max
       FROM analyses a JOIN articles ar ON ar.id = a.article_id WHERE a.id IN (${ph})`,
    ...analysisIds,
  );
  return new Map(rows.map((r) => {
    const p = json<Partial<AiAnalysis>>(r.payload, {});
    const g = gradeEvidence(gradeInputFor(p, r.retraction_status === 'retracted', r.precise === 1 ? { ci_lower: 0, p_raw: null } : undefined, r.n_max));
    return [r.aid, { ...g, qualis: r.stratum ? { stratum: r.stratum, cycle: r.cycle ?? '' } : null, priority: r.priority }];
  }));
}

/** Melhor primeiro: nota do estudo, depois Qualis da revista (sem Qualis por último), depois prioridade editorial. */
export function byBestEvidence(a: Scored, b: Scored): number {
  // 'A1' < 'A2' < … < 'C3' e 'A1' < … < 'B4' < 'C' em ordem de texto.
  return a.grade.localeCompare(b.grade) || (a.qualis?.stratum ?? 'Z').localeCompare(b.qualis?.stratum ?? 'Z') || b.priority - a.priority;
}

/** IDs de análise ordenados do mais bem avaliado para o menos. */
export function rankBest(db: Db, analysisIds: string[]): string[] {
  const s = scoreAnalyses(db, analysisIds);
  return analysisIds.filter((a) => s.has(a)).sort((x, y) => byBestEvidence(s.get(x)!, s.get(y)!));
}
