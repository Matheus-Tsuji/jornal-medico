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
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {/* A nota do estudo vem primeiro e em destaque (pedido do Matheus, 2026-11-16). O aviso de que a análise é
          automática e ainda não revisada fica no banner da capa (PreviewBanner), não em cada card. */}
      {a.evidence && <EvidenceChips a={{ evidence: a.evidence, journalQualis: a.journalQualis ?? null }} />}
      {a.retractionStatus === 'retracted' && <span className="chip chip-danger"><AlertTriangle size={12} aria-hidden /> Retratado</span>}
      {a.isDemo && <span className="chip chip-demo">Fictício · demonstração</span>}
      {a.reviewStatus === 'corrected' && <span className="chip chip-demo">Corrigido</span>}
      {a.reviewStatus === 'reviewed' && <span className="chip chip-ok">Revisado por editor</span>}
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

const TIER_LABEL = { A: 'grupo A', B: 'grupo B', C: 'grupo C' } as const;
const tierOf = (g: EvidenceGrade) => g[0] as keyof typeof TIER_LABEL;
const GRADE_SCALE = [['A', 'Metanálise, revisão sistemática, ensaio randomizado'], ['B', 'Coorte, caso-controle, diretriz'], ['C', 'Demais desenhos']] as const;

/** Selo "Evidência A1" (nota do estudo) e "Qualis A1" (nota da revista na CAPES). */
export function EvidenceChips({ a }: { a: Pick<ArticleCard, 'evidence' | 'journalQualis'> }) {
  const t = tierOf(a.evidence.grade);
  return (
    <>
      <span className={`grade-badge grade-badge-${t}`} title={`Classificação automática do jornal: ${a.evidence.reasons.join(' · ')}`}>
        <span className="sr-only">Força da evidência do estudo (classificação automática): </span>
        <strong className="grade-badge-grade">{a.evidence.grade}</strong>
        <span className="grade-badge-label">{TIER_LABEL[t].replace(/^e/, 'E')}</span>
      </span>
      {a.journalQualis && (
        <span className="chip" title={`Qualis CAPES ${a.journalQualis.cycle} da revista. Classifica a revista, não o estudo.`}>
          <span className="sr-only">Classificação da revista: </span>Qualis {a.journalQualis.stratum}
        </span>
      )}
    </>
  );
}

/** "Por que A1?": explicação da nota, sempre visível como botão (a nota é central para o leitor confiar). */
export function WhyGrade({ evidence }: { evidence: ArticleCard['evidence'] }) {
  const t = tierOf(evidence.grade);
  return (
    <details className="why-grade">
      <summary>
        <span className={`grade-badge grade-badge-${t}`}><strong className="grade-badge-grade">{evidence.grade}</strong></span>
        <span className="grid">
          <span className="why-grade-title">Por que {evidence.grade}?</span>
          <span className="why-grade-hint">Veja o que pesou na nota</span>
        </span>
        <svg className="why-grade-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div className="grid gap-3 p-3 text-sm">
        <ul className="m-0 grid gap-1 list-disc pl-5">{evidence.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="grade-scale">
          {GRADE_SCALE.map(([g, d]) => (
            <div key={g} aria-current={g === t ? 'true' : undefined}><strong>{g}</strong>{d}</div>
          ))}
        </div>
        <p className="m-0 text-xs text-muted">A letra vem do desenho do estudo. O número (1 a 3) cai quando falta IC ou p-valor, a amostra é menor que 500 ou há sinais de incerteza. Classificação automática do jornal, sujeita à validação editorial; não é uma avaliação GRADE e não considera a revista.</p>
      </div>
    </details>
  );
}

/** Resultado principal: frase clara, tabela com medida, IC e p, e o "Por que A1?". Só números reportados; ausências aparecem como ausências. */
// PICO (estudos experimentais: Intervenção) ou PECO (observacionais: Exposição).
const EXPERIMENTAL = new Set(['rct', 'cluster_rct']);
const OBSERVATIONAL = new Set(['cohort', 'case_control', 'cross_sectional']);

/** Resultado principal: frase clara, tabela PICO/PECO e a linha do resultado (medida, IC, p). Só números reportados; ausências aparecem como ausências. */
export function KeyResultPanel({ k, evidence, design, compact = false }: { k: KeyResult; evidence?: ArticleCard['evidence']; design?: string; compact?: boolean }) {
  const ie = design && EXPERIMENTAL.has(design) ? { l: 'I', t: 'Intervenção' } : design && OBSERVATIONAL.has(design) ? { l: 'E', t: 'Exposição' } : { l: 'I/E', t: 'Intervenção ou exposição' };
  const rows: [string, string, string | null | undefined][] = [
    ['P', 'População', k.population],
    [ie.l, ie.t, k.intervention],
    ['C', 'Comparação', k.comparator],
    ['O', 'Desfecho', k.outcome],
  ];
  const na = <span className="font-normal text-muted">não reportado</span>;
  return (
    <section aria-label="Resultado principal" className="tnum grid gap-2 border-t border-line pt-2 text-sm">
      <p className="kicker m-0 text-muted">Resultado principal</p>
      {k.plain && <p className={`m-0 font-serif font-semibold leading-snug ${compact ? 'text-base' : 'text-lg'}`}>{k.plain}</p>}
      <table className={`pico ${compact ? 'pico-compact' : ''}`}>
        <caption className="sr-only">Pergunta do estudo ({ie.l === 'E' ? 'PECO' : 'PICO'}) e resultado principal</caption>
        <tbody>
          {rows.map(([l, t, v]) => (
            <tr key={t}>
              <th scope="row"><span className="pico-letter" aria-hidden>{l}</span><span className="pico-label">{t}</span></th>
              <td><span className="pico-value">{v || na}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className={`pico-result m-0 grid ${compact ? 'grid-cols-2' : 'grid-cols-3'}`}>
        <div><dt>{k.measure ?? 'Medida'}</dt><dd>{fmtVal(k.estimate, k.estimateRaw)}{k.unit === '%' ? '%' : k.unit ? ` ${k.unit}` : ''}</dd></div>
        <div><dt>IC {k.ci ? `${fmtNum(k.ci.level)}%` : ''}</dt><dd>{k.ci ? fmtCi(k.ci) : na}</dd></div>
        {!compact && <div><dt>p-valor</dt><dd>{fmtP(k.p, k.pRaw) ?? na}</dd></div>}
      </dl>
      {evidence && <WhyGrade evidence={evidence} />}
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
