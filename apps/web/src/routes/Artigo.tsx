import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bookmark, BookmarkCheck, Check, ChevronDown, Copy, ExternalLink, Flag, ThumbsDown, ThumbsUp } from 'lucide-react';
import { designLabels, type ArticleDetail, type EvidenceResultDto } from '@jm/contracts';
import { api, ApiError, fmtCi, fmtDate, fmtDateTime, fmtNum, fmtP, fmtVal, useMe, useTopics } from '../lib/api';
import type { LayoutCtx } from '../components/Layout';
import { ErrorState, KeyResultPanel, Loading, PicoTable, StatusChips } from '../components/ui';

const locatorLabel: Record<string, string> = { title: 'título', abstract: 'abstract', result: 'resultados', table: 'tabela', section: 'seção do texto', metadata: 'metadados' };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rule-top py-6">
      <h2 id={id} className="m-0 mb-3 font-serif text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

const Missing = ({ children = 'Não informado no material disponível.' }: { children?: ReactNode }) => <p className="m-0 text-muted italic">{children}</p>;
const Text = ({ v }: { v: string | null | undefined }) => (v ? <p className="m-0 max-w-[68ch] leading-relaxed">{v}</p> : <Missing />);

function ResultsTable({ results }: { results: EvidenceResultDto[] }) {
  if (!results.length) return <Missing>Este tipo de publicação não traz resultados quantitativos estruturados (por exemplo, diretrizes e revisões narrativas).</Missing>;
  return (
    <div className="min-w-0">
      <table role="table" className="results-table tnum w-full border-collapse text-left text-sm">
        <caption className="sr-only">Resultados quantitativos reportados pelo estudo</caption>
        <thead role="rowgroup">
          <tr role="row" className="border-b-2 border-ink text-xs">
            {['Desfecho', 'Medida', 'Estimativa', 'IC', 'p-valor', 'n', 'Origem'].map((h) => <th role="columnheader" key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {results.map((r) => (
            <tr role="row" key={r.id} className="border-b border-line align-top">
              <th role="rowheader" scope="row" className="py-2 pr-3 font-medium">
                {r.outcome}
                <span className="block text-xs font-normal text-muted">
                  {[{ primary: 'primário', secondary: 'secundário', safety: 'segurança', subgroup: 'subgrupo', other: 'outro', unknown: '' }[r.outcomeType], r.comparator && `vs ${r.comparator}`, r.timepoint, r.adjusted ? 'ajustado' : null].filter(Boolean).join(' · ')}
                </span>
              </th>
              <td role="cell" className="py-2 pr-3"><span className="result-label" aria-hidden="true">Medida</span>{r.measure ?? '—'}</td>
              <td role="cell" className="py-2 pr-3 font-semibold" title={r.estimateRaw ?? undefined}><span className="result-label" aria-hidden="true">Estimativa</span>{fmtVal(r.estimate, r.estimateRaw)}{r.estimate !== null && r.unit === '%' ? '%' : r.estimate !== null && r.unit ? ` ${r.unit}` : ''}</td>
              <td role="cell" className="py-2 pr-3" title={r.confidenceInterval?.raw}><span className="result-label" aria-hidden="true">Intervalo de confiança</span>{r.confidenceInterval ? `${fmtNum(r.confidenceInterval.level)}%: ${fmtCi(r.confidenceInterval)}` : <span className="text-muted">não reportado</span>}</td>
              <td role="cell" className="py-2 pr-3" title={r.pValue?.raw}><span className="result-label" aria-hidden="true">p-valor</span>{fmtP(r.pValue, r.pValue?.raw) ?? <span className="text-muted">não reportado</span>}</td>
              <td role="cell" className="py-2 pr-3"><span className="result-label" aria-hidden="true">Amostra (n)</span>{r.sampleSize?.toLocaleString('pt-BR') ?? '—'}</td>
              <td role="cell" className="py-2 text-xs text-muted"><span className="result-label" aria-hidden="true">Origem</span>{locatorLabel[r.evidenceRef.locator] ?? r.evidenceRef.locator}{r.missingReason ? ` · ${r.missingReason}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Gráfico de efeito: só com estimativa + IC reais, mesma família de medida. Eixo log para razões. */
function EffectPlot({ results }: { results: EvidenceResultDto[] }) {
  const rows = results.filter((r) => r.estimate !== null && r.confidenceInterval && (r.measureKind === 'ratio' || r.measureKind === 'difference'));
  const kind = rows[0]?.measureKind;
  const same = rows.filter((r) => r.measureKind === kind && (kind !== 'difference' || r.unit === rows[0]!.unit));
  if (!kind || same.length === 0) return null;
  const ratio = kind === 'ratio';
  const t = (v: number) => (ratio ? Math.log(v) : v);
  const vals = same.flatMap((r) => [r.confidenceInterval!.lower, r.confidenceInterval!.upper]).concat(ratio ? 1 : 0);
  const lo = Math.min(...vals.map(t));
  const hi = Math.max(...vals.map(t));
  const pad = (hi - lo) * 0.1 || 0.1;
  // posição horizontal em % da faixa do gráfico
  const x = (v: number) => ((t(v) - lo + pad) / (hi - lo + 2 * pad)) * 100;
  const nullV = ratio ? 1 : 0;
  return (
    <figure className="m-0 my-5" role="group" aria-label={`Gráfico de efeito com ${same.length} resultado(s); os mesmos dados estão na tabela acima.`}>
      <div className="grid gap-3">
        {same.map((r) => (
          <div key={r.id} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]">
            <p className="m-0 text-sm leading-snug font-medium">{r.outcome}</p>
            <div className="relative h-6" aria-hidden>
              <span className="absolute inset-y-0 border-l border-dashed border-muted/60" style={{ left: `${x(nullV)}%` }} />
              <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-accent" style={{ left: `${x(r.confidenceInterval!.lower)}%`, width: `${x(r.confidenceInterval!.upper) - x(r.confidenceInterval!.lower)}%` }} />
              <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 bg-accent" style={{ left: `${x(r.estimate!)}%` }} />
            </div>
            <p className="tnum m-0 text-sm text-muted sm:text-right">
              {r.measure ? `${r.measure} ` : ''}<strong className="text-ink">{fmtVal(r.estimate, r.estimateRaw)}</strong> ({fmtCi(r.confidenceInterval!)})
            </p>
          </div>
        ))}
        <div className="grid gap-x-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]" aria-hidden>
          <span className="hidden sm:block" />
          <div className="relative h-4 text-[0.7rem] text-muted"><span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `clamp(3.5rem, ${x(nullV)}%, calc(100% - 3.5rem))` }}>{ratio ? '1 = sem diferença' : '0 = sem diferença'}</span></div>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        {ratio ? 'Medidas de razão em escala logarítmica.' : `Diferenças${same[0]!.unit ? ` em ${same[0]!.unit}` : ''}.`} Quadrado = estimativa; linha = intervalo de confiança. A linha tracejada não define “resultado verdadeiro”: leia com o desenho e as limitações.
      </figcaption>
    </figure>
  );
}

function ReportDialog({ articleId, onClose }: { articleId: string; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const m = useMutation({ mutationFn: () => api<{ message: string }>('/reports', { method: 'POST', body: { articleId, message: msg } }) });
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,520px)] border border-line bg-surface p-5 text-ink backdrop:bg-black/40" aria-labelledby="rep-t">
      <h2 id="rep-t" className="m-0 font-serif text-xl font-bold">Sinalizar possível erro científico</h2>
      <p className="text-sm text-muted">Use para números, desenho ou interpretação que pareçam errados. Para dizer que o tema não interessa, use “menos deste tema”.</p>
      {m.isSuccess ? (
        <p role="status" className="font-medium text-primary">{m.data.message}</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">O que parece errado?
            <textarea className="input min-h-28 py-2" value={msg} onChange={(e) => setMsg(e.target.value)} required minLength={10} maxLength={2000} />
          </label>
          {m.error && <p role="alert" className="m-0 text-sm text-danger">{(m.error as ApiError).message}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={m.isPending || msg.trim().length < 10}>Enviar</button>
            <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>Cancelar</button>
          </div>
        </form>
      )}
      {m.isSuccess && <button type="button" className="btn btn-ghost mt-3" onClick={() => ref.current?.close()}>Fechar</button>}
    </dialog>
  );
}

function Actions({ a }: { a: ArticleDetail }) {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [copied, setCopied] = useState('');
  const [report, setReport] = useState(false);
  const [fb, setFb] = useState<string | null>(null);
  const need = () => { if (!me.data) { nav('/entrar'); return true; } return false; };
  const refresh = () => qc.invalidateQueries({ queryKey: ['article', a.slug] });
  const save = useMutation({
    mutationFn: () => (a.bookmarked ? api(`/bookmarks/${a.id}`, { method: 'DELETE' }) : api('/bookmarks', { method: 'POST', body: { articleId: a.id } })),
    onSuccess: refresh,
  });
  const done = useMutation({ mutationFn: () => api('/events/read', { method: 'POST', body: { articleId: a.id, kind: 'complete' } }), onSuccess: refresh });
  const feedback = useMutation({ mutationFn: (value: string) => api('/feedback', { method: 'POST', body: { articleId: a.id, value } }), onSuccess: (_d, v) => setFb(v) });
  const citation = `${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' et al' : ''}. ${a.originalTitle}. ${a.journal ?? a.sourceName}. ${a.pubDate?.slice(0, 4) ?? ''}.${a.doi ? ` doi:${a.doi}` : ''}${a.pmid ? ` PMID: ${a.pmid}` : ''}`;
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000); } catch { setCopied('erro'); }
  };
  return (
    <aside aria-label="Ações" className="grid content-start gap-2 xl:sticky xl:top-16 xl:self-start">
      {a.canonicalUrl ? (
        <a href={a.canonicalUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary"><ExternalLink size={16} aria-hidden /> Abrir publicação original</a>
      ) : (
        <p className="m-0 border border-dashed border-line p-2 text-xs text-muted">Sem link original: item fictício de demonstração.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost" aria-pressed={!!a.bookmarked} onClick={() => !need() && save.mutate()} disabled={save.isPending}>
          {a.bookmarked ? <BookmarkCheck size={16} aria-hidden /> : <Bookmark size={16} aria-hidden />} {a.bookmarked ? 'Salvo' : 'Salvar'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => !need() && done.mutate()} disabled={done.isPending || done.isSuccess}>
          <Check size={16} aria-hidden /> {done.isSuccess ? 'Lido' : 'Marcar lido'}
        </button>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => copy('cit', citation)}><Copy size={16} aria-hidden /> {copied === 'cit' ? 'Citação copiada' : 'Copiar citação'}</button>
      {a.doi && <button type="button" className="btn btn-ghost" onClick={() => copy('doi', a.doi!)}><Copy size={16} aria-hidden /> {copied === 'doi' ? 'DOI copiado' : 'Copiar DOI'}</button>}
      <div className="rule-top mt-2 pt-3">
        <p className="kicker m-0 mb-2 text-muted">Este estudo foi útil para você?</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" aria-pressed={fb === 'relevant'} onClick={() => !need() && feedback.mutate('relevant')}><ThumbsUp size={16} aria-hidden /> Útil</button>
          <button type="button" className="btn btn-ghost" aria-pressed={fb === 'less_of_topic'} onClick={() => !need() && feedback.mutate('less_of_topic')}><ThumbsDown size={16} aria-hidden /> Menos deste tema</button>
        </div>
        {fb && <p role="status" className="m-0 mt-2 text-xs text-muted">Obrigado: isso ajusta apenas a ordem da sua seleção pessoal.</p>}
      </div>
      <button type="button" className="btn btn-danger mt-2" onClick={() => !need() && setReport(true)}><Flag size={16} aria-hidden /> Sinalizar erro científico</button>
      {(save.error || done.error || feedback.error) && <p role="alert" className="m-0 text-sm text-danger">{(save.error || done.error || feedback.error)?.message} Tente novamente.</p>}
      {copied === 'erro' && <p role="alert" className="m-0 text-sm text-danger">Não foi possível copiar. Selecione o texto e copie manualmente.</p>}
      {report && <ReportDialog articleId={a.id} onClose={() => setReport(false)} />}
      <div className="rule-top mt-2 pt-3">
        <p className="kicker m-0 mb-1 text-muted">Comentários</p>
        <p className="m-0 rounded border border-dashed border-line px-3 py-3 text-sm text-muted">Em breve você poderá comentar e discutir este estudo com outros leitores.</p>
      </div>
    </aside>
  );
}

/** "Li Z" → "LI, Z."; "Wang LH" → "WANG, L. H."; nome de grupo fica em maiúsculas. */
function abntAuthor(name: string) {
  const parts = name.trim().split(/\s+/);
  const last = parts.at(-1) ?? '';
  if (parts.length < 2 || !/^[A-Z]{1,4}$/.test(last)) return name.toUpperCase();
  return `${parts.slice(0, -1).join(' ').toUpperCase()}, ${[...last].map((c) => `${c}.`).join(' ')}`;
}

const MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

/** Referência de artigo de periódico conforme ABNT NBR 6023:2018 (até 3 autores; mais que isso, o primeiro + et al.). */
function abntReference(a: Pick<ArticleDetail, 'authors' | 'originalTitle' | 'journal' | 'sourceName' | 'pubDate' | 'doi' | 'canonicalUrl'>, today = new Date()) {
  const au = a.authors.length === 0 ? '' : a.authors.length > 3 ? `${abntAuthor(a.authors[0]!)} et al. ` : `${a.authors.map(abntAuthor).join('; ')}. `;
  const url = a.doi ? `https://doi.org/${a.doi}` : a.canonicalUrl;
  const acesso = `${today.getDate()} ${MESES[today.getMonth()]} ${today.getFullYear()}`;
  return `${au}${a.originalTitle.replace(/\.$/, '')}. ${a.journal ?? a.sourceName}, ${a.pubDate?.slice(0, 4) ?? '[s. d.]'}.${a.doi ? ` DOI: ${a.doi}.` : ''}${url ? ` Disponível em: ${url}. Acesso em: ${acesso}.` : ''}`;
}

function AbntButton({ a }: { a: ArticleDetail }) {
  const [state, setState] = useState<'' | 'ok' | 'erro'>('');
  const ref = abntReference(a);
  const copy = async () => {
    try { await navigator.clipboard.writeText(ref); setState('ok'); setTimeout(() => setState(''), 2000); } catch { setState('erro'); }
  };
  return (
    <div className="grid gap-1">
      <button type="button" className="btn btn-ghost w-fit" onClick={copy}><Copy size={16} aria-hidden /> {state === 'ok' ? 'Referência copiada' : 'Copiar referência (ABNT)'}</button>
      {state === 'erro' && <p role="alert" className="m-0 text-sm text-danger">Não foi possível copiar. Selecione o texto abaixo e copie manualmente.</p>}
      {state === 'erro' && <p className="m-0 text-sm select-all">{ref}</p>}
    </div>
  );
}

export default function Artigo() {
  const { slug = '' } = useParams();
  const prefs = useOutletContext<LayoutCtx>();
  const me = useMe();
  const topics = useTopics();
  const q = useQuery({ queryKey: ['article', slug, me.data?.id ?? 'anon'], queryFn: () => api<ArticleDetail>(`/articles/${slug}`) });
  const loggedRead = useRef<string | null>(null);
  useEffect(() => {
    if (q.data && me.data && loggedRead.current !== `${me.data.id}:${q.data.id}`) {
      loggedRead.current = `${me.data.id}:${q.data.id}`;
      api('/events/read', { method: 'POST', body: { articleId: q.data.id, kind: 'open' } }).catch(() => {});
    }
  }, [q.data, me.data]);

  if (q.isLoading) return <div className="mx-auto max-w-6xl px-4"><Loading lines={8} /></div>;
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404) return <div className="mx-auto max-w-6xl px-4 py-10"><h1 className="font-serif text-3xl">Artigo não encontrado</h1><Link to="/jornal" className="link">Voltar ao jornal</Link></div>;
    return <div className="mx-auto max-w-6xl px-4"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  }
  const a = q.data!;
  const an = a.analysis;
  const t = a.topics[0];
  const chain: { slug: string; label: string }[] = [];
  let cur = topics.data?.find((x) => x.slug === t?.slug);
  while (cur) { chain.unshift({ slug: cur.slug, label: cur.label }); cur = topics.data?.find((x) => x.slug === cur!.parentSlug); }

  return (
    <article className="mx-auto max-w-6xl px-4 pb-10">
      <nav aria-label="Trilha" className="scroll-x py-3 text-sm text-muted">
        <ol className="m-0 flex list-none gap-1.5 p-0 whitespace-nowrap">
          <li><Link to="/jornal" className="hover:underline">Jornal</Link></li>
          {chain.map((c, i) => <li key={c.slug}>/ <Link to={i === 0 ? `/areas/${c.slug}` : `/temas/${c.slug}`} className="hover:underline">{c.label}</Link></li>)}
        </ol>
      </nav>

      {a.isDemo && <p className="m-0 mb-4 border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm font-medium text-warning">Estudo fictício de demonstração. Nenhum número desta página existe na literatura.</p>}
      {a.retractionStatus === 'retracted' && (
        <div role="alert" className="mb-4 border-l-4 border-danger bg-danger-soft px-4 py-3">
          <p className="m-0 flex items-center gap-2 font-bold text-danger"><AlertTriangle size={18} aria-hidden /> Publicação retratada</p>
          <p className="m-0 text-sm">Os resultados abaixo não devem ser usados. A análise é mantida apenas para registro histórico.</p>
          {a.corrections.map((c) => <p key={c.date + c.note} className="m-0 mt-1 text-sm text-muted">{fmtDate(c.date)}: {c.note}</p>)}
        </div>
      )}
      {a.reviewStatus === 'corrected' && a.retractionStatus !== 'retracted' && (
        <div className="mb-4 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
          <p className="m-0 font-bold text-warning">Esta análise foi corrigida</p>
          {a.corrections.map((c) => <p key={c.date + c.note} className="m-0">{fmtDate(c.date)}: {c.note}</p>)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="article-reading min-w-0">
          <header className="grid gap-3 pb-6">
            <p className="kicker m-0 text-muted">{designLabels[a.studyDesign]} · {a.publicationType}</p>
            <h1 className="m-0 font-serif text-3xl leading-tight font-bold tracking-tight text-balance sm:text-[2.6rem]">{a.headline}</h1>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <StatusChips a={a} />
              <span className="chip" title="Base onde o estudo foi encontrado">{a.sourceName.replace(/\s*\(.*\)$/, '')}</span>
              {a.pubDate && <span className="chip"><span className="sr-only">Publicado em </span>{fmtDate(a.pubDate)}</span>}
            </span>
            {a.journal && <p className="m-0 text-sm text-muted italic">{a.journal}</p>}
          </header>

          <nav aria-label="Nesta análise" className="article-jump mb-6">
            <a href="#rapida">Leitura rápida</a>
            <a href="#sobre" onClick={() => { const d = document.getElementById('sobre') as HTMLDetailsElement | null; if (d) d.open = true; }}>Sobre a publicação</a>
            {an && !prefs.quick && <>
              <a href="#desenho">População e métodos</a>
              <a href="#resultados">Resultados</a>
              <a href="#limitacoes">Limitações</a>
            </>}
          </nav>

          {/* Camada 1: leitura rápida */}
          <section aria-labelledby="rapida" className="rule-strong pt-4">
            <h2 id="rapida" className="kicker m-0 mb-3 text-ink">Leitura rápida</h2>
            {a.inShort && <p className="m-0 mb-4 border-l-4 border-primary bg-primary-soft px-4 py-3 font-serif text-lg leading-relaxed"><span className="kicker mb-1 block text-primary">Em poucas palavras</span>{a.inShort}</p>}
            {a.keyResult && <div className="mb-5"><KeyResultPanel k={a.keyResult} evidence={a.evidence} design={a.studyDesign} /></div>}
            {an && <div className="mb-5 border-y border-line py-4">
              <h3 className="m-0 mb-2 font-serif text-xl font-bold">Limitações em destaque</h3>
              {an.limitations.length
                ? <ul className="m-0 grid gap-2 pl-5">{an.limitations.slice(0, 2).map((l) => <li key={l}>{l}</li>)}</ul>
                : <Missing>Limitações não informadas no material disponível.</Missing>}
              {!prefs.quick && <a href="#limitacoes" className="link mt-2 inline-flex min-h-11 items-center text-sm">Ver limitações, vieses e conflitos</a>}
            </div>}
            {a.keyResult && <PicoTable k={a.keyResult} design={a.studyDesign} />}
            <div className="prose-jm font-serif text-[1.08rem]"><p>{a.summary}</p></div>
            <p className="m-0 text-xs text-muted">
              {an?.inputScope === 'abstract_only' || a.accessStatus === 'abstract_only' ? 'Análise baseada somente no abstract.' : an?.inputScope === 'full_text' ? 'Análise baseada no texto integral autorizado.' : ''}
            </p>

          </section>

          <details id="sobre" className="publication-details my-6 border-y border-line py-2">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-primary">
              Sobre a publicação · autores, DOI e classificação
              <span className="publication-toggle ml-auto inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted">
                <span className="publication-toggle-label" />
                <ChevronDown size={14} aria-hidden />
              </span>
            </summary>
            <div className="grid gap-3 pb-3 pt-2">
            <AbntButton a={a} />
            <p className="m-0 text-sm text-muted">Título original: <span lang="en" className="italic">{a.originalTitle}</span></p>
            <dl className="tnum m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-muted">Autores: </dt><dd className="inline">{a.authors.join(', ') || '—'}</dd></div>
              <div><dt className="inline text-muted">Periódico/fonte: </dt><dd className="inline">{a.journal ?? a.sourceName}</dd></div>
              <div><dt className="inline text-muted">Publicação: </dt><dd className="inline">{fmtDate(a.pubDate)}</dd></div>
              <div><dt className="inline text-muted">Processado: </dt><dd className="inline">{fmtDateTime(a.processedAt)}</dd></div>
              {a.doi && <div><dt className="inline text-muted">DOI: </dt><dd className="inline"><a className="link" href={`https://doi.org/${a.doi}`} target="_blank" rel="noopener noreferrer">{a.doi}</a></dd></div>}
              {a.pmid && <div><dt className="inline text-muted">PMID: </dt><dd className="inline">{a.pmid}</dd></div>}
              {a.pmcid && <div><dt className="inline text-muted">PMCID: </dt><dd className="inline">{a.pmcid}</dd></div>}
              <div><dt className="inline text-muted">Força da evidência do estudo: </dt><dd className="inline font-semibold">{a.evidence.grade}</dd></div>
              <div>
                <dt className="inline text-muted">Revista no Qualis CAPES: </dt>
                <dd className="inline">
                  {a.journalClassification
                    ? <><strong>{a.journalClassification.stratum}</strong> ({a.journalClassification.cycle}, <a className="link" href={a.journalClassification.sourceUrl} target="_blank" rel="noopener noreferrer">Plataforma Sucupira</a>). Classifica a revista, não o estudo.</>
                    : 'não encontrada na consulta 2021–2024'}
                </dd>
              </div>
            </dl>
            </div>
          </details>

          {a.locked && (
            <div className="rule-top mt-6 py-6">
              <p className="font-serif text-xl font-bold">A análise aprofundada é exclusiva para assinantes</p>
              <p className="text-muted">Inclui métodos, todos os resultados com intervalo de confiança, limitações e rastreabilidade de cada número.</p>
              <Link to="/assinatura" className="btn btn-primary">Ver planos</Link>
            </div>
          )}

          {/* Camada 2: análise aprofundada */}
          {an && !prefs.quick && (
            <div className="mt-6">
              <Section id="contexto" title="Contexto e pergunta">
                <h3 className="kicker m-0 mb-1 text-muted">Contexto</h3><Text v={an.context} />
                <h3 className="kicker m-0 mt-4 mb-1 text-muted">Objetivo</h3><Text v={an.objective} />
              </Section>
              <Section id="desenho" title="Desenho e população">
                <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {[
                    ['Desenho', designLabels[an.studyDesign]],
                    ['População', an.population.description],
                    ['Amostra', an.population.sampleSize?.toLocaleString('pt-BR')],
                    ['Seguimento', an.population.followUp],
                    ['Intervenção / exposição', an.interventionOrExposure],
                    ['Comparador', an.comparator],
                  ].map(([k, v]) => (
                    <div key={k}><dt className="kicker text-muted">{k}</dt><dd className="m-0">{v ?? <span className="text-muted italic">não informado</span>}</dd></div>
                  ))}
                </dl>
                <h3 className="kicker m-0 mt-4 mb-1 text-muted">Métodos</h3><Text v={an.methods} />
              </Section>
              <Section id="resultados" title="Resultados">
                <ResultsTable results={an.results} />
                <EffectPlot results={an.results} />
                <p className="m-0 mt-3 max-w-[68ch] text-xs text-muted">P-valor e intervalo de confiança são reportados por desfecho, como na fonte. O p-valor mede a compatibilidade dos dados com a hipótese nula sob os pressupostos do teste; não é a probabilidade de o resultado ser verdadeiro. Resultado não significativo não prova ausência de efeito.</p>
              </Section>
              <Section id="importancia" title="Importância clínica e aplicabilidade">
                <Text v={an.clinicalImplications} />
                <h3 className="kicker m-0 mt-4 mb-1 text-muted">A quem se aplica</h3><Text v={an.applicability} />
                <p className="m-0 mt-3 text-xs text-muted">Conteúdo informativo. Não constitui recomendação de conduta para pacientes nem indica mudança de protocolo.</p>
              </Section>
              <Section id="limitacoes" title="Limitações, vieses e conflitos">
                {an.limitations.length ? <ul className="m-0 grid gap-1 pl-5">{an.limitations.map((l) => <li key={l}>{l}</li>)}</ul> : <Missing />}
                <dl className="m-0 mt-4 grid gap-3 sm:grid-cols-3">
                  <div><dt className="kicker text-muted">Risco de viés</dt><dd className="m-0">{an.riskOfBias.status === 'preliminary_signals' ? an.riskOfBias.rationale : 'Não avaliado formalmente.'}</dd></div>
                  <div><dt className="kicker text-muted">Financiamento</dt><dd className="m-0">{an.funding ?? <span className="text-muted italic">não informado</span>}</dd></div>
                  <div><dt className="kicker text-muted">Conflitos de interesse</dt><dd className="m-0">{an.conflictsOfInterest ?? <span className="text-muted italic">não informado</span>}</dd></div>
                </dl>
              </Section>
            </div>
          )}
          {an && prefs.quick && <p className="rule-top mt-6 pt-4 text-sm text-muted">Modo leitura rápida ativo. Recarregue a página para ver a análise aprofundada.</p>}
          {a.reviewStatus === 'ai_unreviewed' && (
            <p className="m-0 mt-6 border-l-2 border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
              Analisado por IA ({a.model}), ainda sem revisão de editor. Confira os números na publicação original.
            </p>
          )}
        </div>
        <Actions a={a} />
      </div>
    </article>
  );
}
