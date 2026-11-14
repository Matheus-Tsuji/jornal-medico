import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, FlaskConical, RefreshCw } from 'lucide-react';
import type { ArticleCard, EvidenceGrade, KeyResult } from '@jm/contracts';
import { ApiError, fmtCi, fmtNum, fmtP, fmtVal } from '../lib/api';

export function Loading({ label = 'Carregando…', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="py-8">
      <span className="sr-only">{label}</span>
      <div className="skeleton mb-4 h-8 w-3/4" aria-hidden />
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton mb-2 h-4" style={{ width: `${90 - i * 12}%` }} aria-hidden />)}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'offline';
  return (
    <div role="alert" className="my-6 border-l-4 border-danger bg-danger-soft px-4 py-3">
      <p className="font-semibold">{offline ? 'Você está sem conexão' : 'Não foi possível carregar'}</p>
      <p className="text-sm text-muted">{e?.message ?? 'Erro inesperado.'}{e?.requestId ? ` (código ${e.requestId.slice(0, 8)})` : ''}</p>
      {retry && (
        <button type="button" className="btn btn-ghost mt-2" onClick={retry}><RefreshCw size={16} aria-hidden /> Tentar de novo</button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="my-8 border-t border-b border-line py-10 text-center">
      <p className="font-serif text-xl font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-muted">{children}</div>}
    </div>
  );
}

export function PreviewBanner() {
  return (
    <div className="border-y border-warning bg-warning-soft text-warning">
      <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-sm font-medium">
        <FlaskConical size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <strong>Prévia automática.</strong> Estudos reais do PubMed resumidos por IA e ainda <strong>não revisados</strong> pela equipe editorial. Confira os números na publicação original antes de qualquer uso.
        </span>
      </p>
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="border-y border-warning bg-warning-soft text-warning">
      <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-sm font-medium">
        <FlaskConical size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <strong>Edição de demonstração.</strong> Todos os estudos desta tela são fictícios e servem só para mostrar o formato. Não use para decisões clínicas.
        </span>
      </p>
    </div>
  );
}

export function StatusChips({ a }: { a: Pick<ArticleCard, 'isDemo' | 'reviewStatus' | 'retractionStatus'> & Partial<Pick<ArticleCard, 'evidence' | 'journalQualis'>> & { accessStatus?: string } }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {a.evidence && <EvidenceChips a={{ evidence: a.evidence, journalQualis: a.journalQualis ?? null }} />}
      {a.isDemo && <span className="chip chip-demo">Fictício · demonstração</span>}
      {a.retractionStatus === 'retracted' && <span className="chip chip-danger"><AlertTriangle size={12} aria-hidden /> Retratado</span>}
      {a.reviewStatus === 'corrected' && <span className="chip chip-demo">Corrigido</span>}
      {a.reviewStatus === 'reviewed' && <span className="chip chip-ok">Revisado por editor</span>}
      {a.reviewStatus === 'ai_unreviewed' && <span className="chip chip-demo">IA · não revisado por editor</span>}
      {a.accessStatus === 'abstract_only' && <span className="chip">Baseado no abstract</span>}
    </span>
  );
}

/** Uma linha com o resultado principal: "HR 0,78 (IC 95% 0,64 a 0,95; p = 0,01)". */
export function ResultLine({ k }: { k: KeyResult }) {
  const parts = [k.ci ? `IC ${fmtNum(k.ci.level)}% ${fmtCi(k.ci)}` : null, fmtP(k.p, k.pRaw)].filter(Boolean);
  if (k.estimate == null && !k.estimateRaw && parts.length === 0) return null; // nada reportado: sem linha vazia com "—"
  return (
    <p className="tnum m-0 text-sm">
      <span className="text-muted">{k.outcome}: </span>
      <strong>{k.measure ? `${k.measure} ` : ''}{fmtVal(k.estimate, k.estimateRaw)}{k.unit === '%' ? '%' : k.unit ? ` ${k.unit}` : ''}</strong>
      {parts.length > 0 && <span className="text-muted"> ({parts.join('; ')})</span>}
    </p>
  );
}

const TIER_LABEL = { A: 'evidência forte', B: 'evidência intermediária', C: 'evidência fraca' } as const;
const tierOf = (g: EvidenceGrade) => g[0] as keyof typeof TIER_LABEL;

/** Selo "Evidência A1" (nota do estudo) e "Qualis A1" (nota da revista na CAPES). */
export function EvidenceChips({ a }: { a: Pick<ArticleCard, 'evidence' | 'journalQualis'> }) {
  const t = tierOf(a.evidence.grade);
  return (
    <>
      <span className={`chip chip-grade-${t}`} title={a.evidence.reasons.join(' · ')}>
        <span className="sr-only">Força da evidência do estudo: </span>Evidência {a.evidence.grade}<span className="sr-only"> ({TIER_LABEL[t]})</span>
      </span>
      {a.journalQualis && (
        <span className="chip" title={`Qualis CAPES ${a.journalQualis.cycle} da revista. Classifica a revista, não o estudo.`}>
          <span className="sr-only">Classificação da revista: </span>Qualis {a.journalQualis.stratum}
        </span>
      )}
    </>
  );
}

/** Resultado principal: nota do estudo, frase clara e o número em destaque. Só números reportados; ausências aparecem como ausências. */
export function KeyResultPanel({ k, evidence, compact = false }: { k: KeyResult; evidence?: ArticleCard['evidence']; compact?: boolean }) {
  const unit = k.unit === '%' ? '%' : k.unit ? ` ${k.unit}` : '';
  const ci = k.ci ? `IC ${fmtNum(k.ci.level)}% ${fmtCi(k.ci)}` : 'IC não reportado';
  const p = fmtP(k.p, k.pRaw) ?? 'p-valor não reportado';
  return (
    <section aria-label="Resultado principal" className="tnum grid gap-1.5 border-t border-line pt-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="kicker m-0 text-muted">Resultado principal</p>
        {evidence && (
          <span className={`chip chip-grade-${tierOf(evidence.grade)}`} title={evidence.reasons.join(' · ')}>
            Evidência {evidence.grade} · {TIER_LABEL[tierOf(evidence.grade)]}
          </span>
        )}
      </div>
      {k.plain && <p className={`m-0 font-serif font-semibold leading-snug ${compact ? 'text-base' : 'text-lg'}`}>{k.plain}</p>}
      <p className="m-0 text-muted">{k.outcome}</p>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        {k.measure && <span className="text-muted">{k.measure}</span>}
        <strong className={`${compact ? 'text-xl' : 'text-3xl'} font-bold leading-none text-ink`}>{fmtVal(k.estimate, k.estimateRaw)}{unit}</strong>
      </p>
      <p className="m-0 text-muted">{ci} · {p}</p>
      {evidence && !compact && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Por que {evidence.grade}?</summary>
          <ul className="m-0 mt-1 list-disc pl-5">{evidence.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="m-0 mt-1">A letra vem do desenho do estudo (A: metanálise, revisão sistemática ou ensaio randomizado; B: coorte, caso-controle, diretriz; C: demais). O número cai com resultado sem IC/p-valor, amostra abaixo de 500 ou sinais de incerteza. O periódico não entra nesta nota.</p>
        </details>
      )}
    </section>
  );
}

export function TopicKicker({ topics, extra }: { topics: ArticleCard['topics']; extra?: string }) {
  const t = topics[0];
  return (
    <p className="kicker m-0 flex flex-wrap items-center gap-x-2">
      {t && (
        <Link to={`/temas/${t.slug}`} className="topic-text hover:underline" style={{ '--topic': t.color ?? undefined } as React.CSSProperties}>
          {t.label}
        </Link>
      )}
      {extra && <span className="text-muted">{extra}</span>}
    </p>
  );
}

export function PageTitle({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <header className="rule-strong mb-6 pt-4">
      {kicker && <p className="kicker m-0 text-muted">{kicker}</p>}
      <h1 className="m-0 mt-1 font-serif text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="mt-2 max-w-prose text-muted">{children}</div>}
    </header>
  );
}
