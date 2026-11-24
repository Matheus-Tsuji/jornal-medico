// Contratos compartilhados entre web e servidor.
// Entradas da API são validadas com zod nos dois lados; saídas são tipos TS.
import { z } from 'zod';

// ---------- Entradas da API ----------
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))
  // Domínio reservado das contas de visitante: nunca é um e-mail de verdade.
  .refine((e) => !e.endsWith('@visitante.invalid'), 'E-mail inválido.');

/** Evento de webhook de assinatura (provedor-agnóstico). */
export const billingEventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(['subscription.activated', 'subscription.renewed', 'payment.failed', 'subscription.canceled']),
  data: z.object({ subscriptionId: z.string().min(1).max(200), currentPeriodEnd: z.iso.datetime().optional() }),
});
export type BillingEvent = z.infer<typeof billingEventSchema>;

export const requestCodeInput = z.strictObject({ email: emailSchema });
/** Cadastro/entrada com senha (8 a 128 caracteres). */
export const passwordAuthInput = z.strictObject({ email: emailSchema, password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(128) });
/** Cadastro: também o nome de exibição (espaços, acentos e maiúsculas permitidos). */
export const passwordRegisterInput = passwordAuthInput.extend({ displayName: z.string().trim().min(2, 'Informe seu nome (pelo menos 2 letras).').max(80, 'Nome muito longo.') });
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
  /** Aprovar análise bloqueada pelo validador exige confirmação explícita e justificativa substantiva (30+ caracteres). */
  overrideBlocked: z.boolean().optional(),
  edits: z
    .strictObject({
      editorialHeadline: z.string().trim().min(5).max(200).optional(),
      summary: z.string().trim().min(20).max(1500).optional(),
      inShort: z.string().trim().min(10).max(400).optional(),
    })
    .optional(),
});

export const checkoutInput = z.strictObject({ planId: z.string().max(64) });

export const idParam = z.object({ id: z.string().max(64) });
export const slugParam = z.object({ slug: z.string().max(200) });
export const topicSlugParam = z.object({ slug: z.string().max(80) });
export const authResponseSchema = z.object({ ok: z.literal(true), onboarded: z.boolean() });
export const adminProcessJobsResponse = z.object({ processed: z.number().int().nonnegative() });
export const adminIngestionInput = z.strictObject({ topic: z.string().max(80).optional() });
export const adminProcessJobsInput = z.strictObject({ max: z.number().int().min(1).max(20).default(5) });
export const adminPublishEditionInput = z.strictObject({ editionId: z.string().max(64).optional() });
export const adminReportInput = z.strictObject({ status: z.enum(['open', 'investigating', 'resolved', 'dismissed']) });
export const adminFlagInput = z.strictObject({ enabled: z.boolean() });
export const adminPlanInput = z.strictObject({ name: z.string().min(2).max(60).optional(), priceCents: z.number().int().min(0).max(1_000_000).optional(), active: z.boolean().optional() });
export const adminUserInput = z.strictObject({ role: z.enum(['reader', 'editor', 'admin']).optional(), status: z.enum(['active', 'disabled']).optional() });

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
  /** Nome de exibição escolhido no cadastro; null para contas antigas e visitantes. */
  displayName: string | null;
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

const cardKeyResult = z.object({
  plain: z.string().nullable().optional(), outcome: z.string(),
  measure: z.string().nullable(), estimate: z.number().nullable(), estimateRaw: z.string().nullable(),
  unit: z.string().nullable(), ci: z.object({ level: z.number(), lower: z.number(), upper: z.number(), raw: z.string() }).nullable(),
  pRaw: z.string().nullable(),
  p: z.object({ operator: z.enum(['=', '<', '<=', '>', '>=']), value: z.number() }).nullable(),
  population: z.string().nullable().optional(), intervention: z.string().nullable().optional(), comparator: z.string().nullable().optional(),
});

const articleCardSchema = z.object({
  id: z.string(), slug: z.string(), headline: z.string(), originalTitle: z.string(), inShort: z.string().nullable(),
  studyDesign: z.enum(studyDesigns), publicationType: z.string(), journal: z.string().nullable(), sourceName: z.string(),
  pubDate: z.string().nullable(), topics: z.array(z.object({ slug: z.string(), label: z.string(), color: z.string().nullable() })),
  isDemo: z.boolean(), retractionStatus: z.enum(['none', 'corrected', 'retracted']), accessStatus: z.string(),
  keyResult: cardKeyResult.nullable(), evidence: z.object({ grade: z.enum(evidenceGrades), reasons: z.array(z.string()) }),
  journalQualis: z.object({ stratum: z.string(), cycle: z.string() }).nullable(), readingMinutes: z.number(),
  reviewStatus: z.enum(['reviewed', 'demo', 'corrected', 'retracted', 'ai_unreviewed']),
  bookmarked: z.boolean().optional(), read: z.boolean().optional(), reasons: z.array(z.string()).optional(),
});

export const articleListResponse = z.object({ items: z.array(articleCardSchema), nextCursor: z.string().nullable() });

export type ArticleCard = z.infer<typeof articleCardSchema>;

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
