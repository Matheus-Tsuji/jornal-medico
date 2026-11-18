// Contratos compartilhados entre web e servidor.
// Entradas da API são validadas com zod nos dois lados; saídas são tipos TS.
import { z } from 'zod';

// ---------- Entradas da API ----------
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const requestCodeInput = z.strictObject({ email: emailSchema });
export const verifyCodeInput = z.strictObject({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.'),
});

export const professionalProfiles = ['medico', 'residente', 'estudante', 'outro'] as const;

export const updateMeInput = z.strictObject({
  profile: z.enum(professionalProfiles).nullable().optional(),
  personalizationEnabled: z.boolean().optional(),
  onboarded: z.literal(true).optional(),
});

export const updatePreferencesInput = z.strictObject({
  topics: z.array(z.string().max(80)).max(200),
  sources: z.array(z.string().max(80)).max(50).default([]),
});

export const followTopicInput = z.strictObject({ follow: z.boolean() });

export const readEventInput = z.strictObject({
  articleId: z.string().max(64),
  kind: z.enum(['open', 'complete']),
});

export const feedbackInput = z.strictObject({
  articleId: z.string().max(64),
  value: z.enum(['relevant', 'not_relevant', 'less_of_topic']),
});

export const errorReportInput = z.strictObject({
  articleId: z.string().max(64),
  message: z.string().trim().min(10, 'Descreva o problema em pelo menos 10 caracteres.').max(2000),
});

export const reviewDecisionInput = z.strictObject({
  decision: z.enum(['approve', 'reject', 'request_changes']),
  justification: z.string().trim().min(5, 'Justifique a decisão.').max(2000),
  edits: z
    .strictObject({
      editorialHeadline: z.string().trim().min(5).max(200).optional(),
      summary: z.string().trim().min(20).max(1500).optional(),
      inShort: z.string().trim().min(10).max(400).optional(),
    })
    .optional(),
});

export const checkoutInput = z.strictObject({ planId: z.string().max(64) });

export const articleListQuery = z.object({
  topic: z.string().max(80).optional(),
  design: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(['recent', 'priority']).default('recent'),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------- Saída estruturada da IA (contrato do modelo) ----------
// Sem limites de tamanho aqui: o JSON Schema estrito vai para o provedor; os limites
// são checados pelo validador determinístico do servidor.
export const studyDesigns = [
  'rct', 'cluster_rct', 'cohort', 'case_control', 'cross_sectional', 'systematic_review',
  'meta_analysis', 'narrative_review', 'guideline', 'case_report', 'diagnostic_accuracy',
  'economic_evaluation', 'qualitative', 'other', 'unknown',
] as const;
export type StudyDesign = (typeof studyDesigns)[number];

export const locators = ['title', 'abstract', 'result', 'table', 'section', 'metadata'] as const;
export const reviewFlags = [
  'requires_human_review', 'insufficient_input', 'conflicting_data', 'possible_prompt_injection',
  'numeric_uncertainty', 'retraction_or_correction', 'validation_failed',
] as const;

const nstr = z.string().nullable();

export const aiResultSchema = z.strictObject({
  outcome: z.string(),
  outcomeType: z.enum(['primary', 'secondary', 'safety', 'subgroup', 'other', 'unknown']),
  measure: nstr,
  measureKind: z.enum(['ratio', 'difference', 'proportion', 'mean', 'other']).nullable(),
  estimate: z.number().nullable(),
  estimateRaw: nstr,
  unit: nstr,
  comparator: nstr,
  population: nstr,
  timepoint: nstr,
  confidenceInterval: z
    .strictObject({ level: z.number(), lower: z.number(), upper: z.number(), raw: z.string() })
    .nullable(),
  pValue: z
    .strictObject({ raw: z.string(), operator: z.enum(['=', '<', '<=', '>', '>=']), value: z.number() })
    .nullable(),
  sampleSize: z.number().int().nullable(),
  adjusted: z.boolean().nullable(),
  evidenceRef: z.strictObject({ locator: z.enum(locators), quote: nstr }),
  missingReason: nstr,
});
export type AiResult = z.infer<typeof aiResultSchema>;

export const aiAnalysisSchema = z.strictObject({
  inputScope: z.enum(['abstract_only', 'full_text', 'metadata_only']),
  language: z.literal('pt-BR'),
  editorialHeadline: nstr,
  summary: nstr,
  inShort: nstr,
  plainResult: nstr,
  context: nstr,
  objective: nstr,
  studyDesign: z.enum(studyDesigns),
  population: z.strictObject({ description: nstr, sampleSize: z.number().int().nullable(), followUp: nstr }),
  interventionOrExposure: nstr,
  comparator: nstr,
  methods: nstr,
  results: z.array(aiResultSchema),
  clinicalImplications: nstr,
  applicability: nstr,
  limitations: z.array(z.string()),
  riskOfBias: z.strictObject({
    status: z.enum(['not_assessed', 'preliminary_signals']),
    method: nstr,
    rationale: nstr,
  }),
  funding: nstr,
  conflictsOfInterest: nstr,
  claims: z.array(
    z.strictObject({
      text: z.string(),
      locator: z.enum(locators),
      quote: nstr,
      support: z.enum(['direct', 'partial', 'editorial_interpretation']),
      origin: z.enum(['authors', 'observed_data', 'editorial']),
    }),
  ),
  missingFields: z.array(
    z.strictObject({
      field: z.string(),
      reason: z.enum(['not_reported_in_available_material', 'not_applicable', 'requires_full_text']),
    }),
  ),
  reviewFlags: z.array(z.enum(reviewFlags)),
  editorialPriority: z.strictObject({ score: z.number(), rationale: z.string() }),
});
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

// ---------- Saídas da API ----------
export type Role = 'reader' | 'editor' | 'admin';

export interface ApiError { code: string; message: string; requestId: string }

export interface Me {
  id: string;
  /** Vazio para visitante. */
  email: string;
  isGuest: boolean;
  role: Role;
  profile: string | null;
  personalizationEnabled: boolean;
  onboarded: boolean;
  entitled: boolean;
  preferences: { topics: string[]; sources: string[] };
}

export interface Topic {
  id: string;
  slug: string;
  parentSlug: string | null;
  level: 'area' | 'subarea' | 'tema';
  label: string;
  enabled: boolean;
  color: string | null;
}

export interface Source {
  id: string; slug: string; name: string; kind: string; officialUrl: string; status: string; enabled: boolean;
}

/** Força da evidência do estudo: letra = desenho, número = precisão/amostra/incerteza (A1 é a mais forte). */
export const evidenceGrades = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'] as const;
export type EvidenceGrade = (typeof evidenceGrades)[number];

export interface KeyResult {
  /** Frase em português claro sobre o resultado (redação por IA, validada; null em análises antigas). */
  plain?: string | null;
  outcome: string;
  measure: string | null;
  estimate: number | null;
  estimateRaw: string | null;
  unit: string | null;
  ci: { level: number; lower: number; upper: number; raw: string } | null;
  pRaw: string | null;
  p: { operator: '=' | '<' | '<=' | '>' | '>='; value: number } | null;
  /** PICO/PECO: população, intervenção ou exposição e comparação, como a análise extraiu (null quando ausentes). */
  population?: string | null;
  intervention?: string | null;
  comparator?: string | null;
}

export interface ArticleCard {
  id: string;
  slug: string;
  headline: string;
  originalTitle: string;
  inShort: string | null;
  studyDesign: StudyDesign;
  publicationType: string;
  journal: string | null;
  sourceName: string;
  pubDate: string | null;
  topics: { slug: string; label: string; color: string | null }[];
  isDemo: boolean;
  retractionStatus: 'none' | 'corrected' | 'retracted';
  accessStatus: string;
  keyResult: KeyResult | null;
  evidence: { grade: EvidenceGrade; reasons: string[] };
  /** Qualis CAPES da revista (estrato oficial), quando encontrado. */
  journalQualis: { stratum: string; cycle: string } | null;
  readingMinutes: number;
  reviewStatus: 'reviewed' | 'demo' | 'corrected' | 'retracted' | 'ai_unreviewed';
  bookmarked?: boolean;
  read?: boolean;
  reasons?: string[];
}

export interface EvidenceResultDto extends AiResult { id: string }

export interface ArticleDetail extends ArticleCard {
  authors: string[];
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  canonicalUrl: string | null;
  processedAt: string;
  reviewedAt: string | null;
  reviewerLabel: string | null;
  analysisVersion: number;
  promptVersion: string;
  model: string;
  locked: boolean;
  journalClassification: { system: string; stratum: string; cycle: string; sourceUrl: string } | null;
  analysis: (Omit<AiAnalysis, 'results'> & { results: EvidenceResultDto[] }) | null;
  summary: string | null;
  corrections: { date: string; note: string }[];
}

export interface EditionDto {
  id: string;
  date: string;
  number: number;
  version: number;
  publishedAt: string | null;
  isDemo: boolean;
  /** Prévia montada na hora com análises de IA ainda não revisadas (não é edição publicada). */
  isPreview?: boolean;
  /** Prévia: quantos estudos o ciclo diário trouxe nas últimas 36 h (vêm primeiro na capa). */
  freshCount?: number;
  todayCount?: number;
  coverageNote: string | null;
  headline: ArticleCard | null;
  secondary: ArticleCard[];
  sections: { topic: { slug: string; label: string; color: string | null }; items: ArticleCard[] }[];
  forYou: ArticleCard[];
  totalReadingMinutes: number;
}

export interface EditionSummary { date: string; number: number; isDemo: boolean; headline: string | null; items: number }

export interface Plan { id: string; slug: string; name: string; priceCents: number; currency: 'BRL'; interval: 'month' | 'year'; active: boolean; description: string }

export interface SubscriptionDto {
  status: 'none' | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled';
  plan: Plan | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string | null;
  entitled: boolean;
}

export interface Paged<T> { items: T[]; nextCursor: string | null }

export interface PublicConfig {
  brandName: string;
  realContent: boolean;
  paywall: boolean;
  paymentProvider: string;
  devOutbox: boolean;
  /** false em produção sem provedor de e-mail: só o acesso de visitante funciona. */
  emailLogin: boolean;
  /** Vitrine sem banco persistente: o que o leitor salva pode se perder. */
  ephemeral: boolean;
  features: Record<string, boolean>;
  editionHour: string;
  timezone: string;
}

export const designLabels: Record<StudyDesign, string> = {
  rct: 'Ensaio clínico randomizado',
  cluster_rct: 'Ensaio randomizado por conglomerados',
  cohort: 'Coorte',
  case_control: 'Caso-controle',
  cross_sectional: 'Transversal',
  systematic_review: 'Revisão sistemática',
  meta_analysis: 'Metanálise',
  narrative_review: 'Revisão narrativa',
  guideline: 'Diretriz',
  case_report: 'Relato de caso',
  diagnostic_accuracy: 'Acurácia diagnóstica',
  economic_evaluation: 'Avaliação econômica',
  qualitative: 'Qualitativo',
  other: 'Outro',
  unknown: 'Desenho não identificado',
};

// Documentos oficiais e descoberta bibliográfica não são análises editoriais.
export interface MonitoredDocument {
  id: string;
  source: string;
  kind: 'regulation' | 'publication';
  title: string;
  identifier: string;
  description: string | null;
  date: string | null;
  dateLabel: string;
  url: string;
  stage: string;
  technology: boolean;
}
export interface MonitorSource {
  id: string; name: string; kind: 'regulation' | 'publication';
  url: string; mode: 'automatic' | 'reference'; scope: string;
  lastSuccessAt: string | null; error: string | null;
}
export interface MonitorDto { items: MonitoredDocument[]; sources: MonitorSource[] }
