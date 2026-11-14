// Painel editorial interno. A UI esconde o que não cabe ao papel, mas quem decide é o servidor.
import { useState } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiAnalysis } from '@jm/contracts';
import { api, ApiError, fmtBRL, fmtDateTime, useMe } from '../lib/api';
import { Empty, ErrorState, Loading } from '../components/ui';
import ScrollRow from '../components/ScrollRow';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function useAdmin<T>(path: string, key: unknown[] = []) {
  return useQuery({ queryKey: ['admin', path, ...key], queryFn: () => api<T>(path) });
}

function Table({ rows, cols }: { rows: Row[]; cols: [string, string, ((r: Row) => React.ReactNode)?][] }) {
  if (!rows.length) return <p className="text-muted">Nada por aqui.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tnum w-full min-w-[640px] border-collapse text-left text-sm">
        <thead><tr className="border-b-2 border-ink">{cols.map(([k, l]) => <th key={k} scope="col" className="py-2 pr-3">{l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? r.key ?? i)} className="border-b border-line align-top">
              {cols.map(([k, , f]) => <td key={k} className="max-w-[28rem] py-2 pr-3 break-words">{f ? f(r) : s(r[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: unknown }) {
  return <div className="border-t-2 border-ink pt-2"><p className="kicker m-0 text-muted">{label}</p><p className="tnum m-0 font-serif text-3xl font-bold">{s(v ?? 0)}</p></div>;
}

function Overview() {
  const q = useAdmin<Row & { reviews: Record<string, number>; jobs: Record<string, number>; articles: Row; ai: Row; today: string }>('/admin/overview');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Em revisão" v={d.reviews.in_review} />
        <Stat label="Bloqueadas" v={d.reviews.blocked} />
        <Stat label="Publicadas (reais)" v={d.reviews.published} />
        <Stat label="Relatos abertos" v={d.openReports} />
        <Stat label="Artigos ingeridos" v={d.articles.total} />
        <Stat label="Elegíveis" v={d.articles.eligible} />
        <Stat label="Jobs com falha" v={(d.jobs.failed ?? 0) + (d.jobs.blocked ?? 0)} />
        <Stat label="Possíveis duplicatas" v={d.duplicateCandidates} />
      </div>
      <p className="m-0 text-sm">IA: {d.ai.configured ? <>configurada · análise <code>{s(d.ai.analysisModel)}</code> · redação <code>{s(d.ai.editorialModel)}</code></> : <strong className="text-warning">não configurada (sem OPENAI_API_KEY): análises reais ficam bloqueadas</strong>}</p>
    </div>
  );
}

function Reviews() {
  const [status, setStatus] = useState('');
  const q = useAdmin<{ items: Row[] }>(`/admin/reviews${status ? `?status=${status}` : ''}`, [status]);
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm">Situação
        <select className="input !w-auto !min-h-10" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Pendentes (em revisão + bloqueadas)</option>
          {['in_review', 'blocked', 'published', 'rejected', 'superseded', 'demo'].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <Table rows={q.data!.items} cols={[
          ['headline', 'Análise', (r) => <Link className="link" to={`/admin/revisao/${s(r.id)}`}>{s(r.headline ?? r.original_title)}</Link>],
          ['status', 'Situação', (r) => <span className={`chip ${r.status === 'blocked' ? 'chip-danger' : ''}`}>{s(r.status)}{r.is_demo ? ' · demo' : ''}</span>],
          ['flags', 'Sinalizações', (r) => (r.flags as string[]).join(', ') || '—'],
          ['validation', 'Validação', (r) => `${(r.validation as string[]).length} aviso(s)`],
          ['created_at', 'Criada', (r) => fmtDateTime(r.created_at as string)],
        ]} />
      )}
    </div>
  );
}

function ReviewDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useAdmin<{ analysis: Row & { payload: AiAnalysis; validation: string[] }; results: Row[]; claims: Row[]; article: Row & { authors: string[]; publication_types: string[] }; sources: Row[]; reviews: Row[]; versions: Row[] }>(`/admin/reviews/${id}`, [id]);
  const [just, setJust] = useState('');
  const [edits, setEdits] = useState<{ editorialHeadline?: string; summary?: string; inShort?: string }>({});
  const decide = useMutation({
    mutationFn: (decision: string) => api(`/admin/reviews/${id}/decision`, { method: 'POST', body: { decision, justification: just, ...(Object.keys(edits).length ? { edits } : {}) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const { analysis: a, article, results, sources, reviews } = q.data!;
  const p = a.payload;
  const reviewable = ['in_review', 'blocked'].includes(a.status as string);
  return (
    <div className="grid gap-6">
      <Link to="/admin/revisao" className="link text-sm">← Voltar à fila</Link>
      <div>
        <p className="kicker m-0 text-muted">Versão {s(a.version)} · {s(a.status)} · modelo {s(a.model)} · prompt {s(a.prompt_version)} · escopo {s(a.input_scope)}</p>
        <h2 className="m-0 font-serif text-2xl font-bold">{p.editorialHeadline ?? s(article.original_title)}</h2>
        <p className="m-0 text-sm text-muted">{s(article.original_title)} · PMID {s(article.pmid)} · DOI {s(article.doi)} {article.retraction_status !== 'none' && <strong className="text-danger">· {s(article.retraction_status)}</strong>}</p>
      </div>
      {(a.validation.length > 0 || p.reviewFlags.length > 0) && (
        <div className="border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm">
          <p className="m-0 font-bold text-warning">Sinalizações: {p.reviewFlags.join(', ') || '—'}</p>
          <ul className="m-0 mt-1 pl-5">{a.validation.map((v) => <li key={v}>{v}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border border-line bg-surface p-4">
          <h3 className="kicker m-0 mb-2">Material de origem (uso interno)</h3>
          {sources.map((src) => (
            <div key={s(src.external_id)} className="text-sm">
              <p className="m-0 text-xs text-muted">ID {s(src.external_id)} · licença {s(src.license)} · obtido {fmtDateTime(src.retrieved_at as string)}</p>
              <pre className="mt-2 font-serif text-[0.95rem] leading-relaxed whitespace-pre-wrap">{s(src.abstract_text)}</pre>
            </div>
          ))}
        </section>
        <section className="grid content-start gap-3 text-sm">
          <h3 className="kicker m-0">Extração</h3>
          <p className="m-0"><strong>Desenho:</strong> {p.studyDesign} · <strong>População:</strong> {s(p.population?.description)} · <strong>n:</strong> {s(p.population?.sampleSize)}</p>
          <Table rows={results} cols={[['outcome', 'Desfecho'], ['measure', 'Medida'], ['estimate_raw', 'Estimativa'], ['ci_raw', 'IC'], ['p_raw', 'p'], ['evidence_quote', 'Trecho']]} />
          <p className="m-0"><strong>Limitações:</strong> {p.limitations.join(' · ') || '—'}</p>
          <p className="m-0"><strong>Ausentes:</strong> {p.missingFields.map((m) => `${m.field} (${m.reason})`).join(', ') || '—'}</p>
        </section>
      </div>
      {reviewable ? (
        <form className="grid gap-3 border-t-2 border-ink pt-4" onSubmit={(e) => e.preventDefault()}>
          <h3 className="m-0 font-serif text-xl font-bold">Texto editorial</h3>
          {(['editorialHeadline', 'inShort', 'summary'] as const).map((k) => (
            <label key={k} className="grid gap-1 text-sm font-semibold">{{ editorialHeadline: 'Manchete', inShort: 'Em poucas palavras', summary: 'Resumo' }[k]}
              <textarea className="input min-h-16 py-2 font-normal" defaultValue={p[k] ?? ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
            </label>
          ))}
          <label className="grid gap-1 text-sm font-semibold">Justificativa da decisão (obrigatória)
            <textarea className="input min-h-16 py-2 font-normal" value={just} onChange={(e) => setJust(e.target.value)} placeholder="Ex.: números conferidos com o abstract; IC e p batem." />
          </label>
          {decide.error && <p role="alert" className="m-0 text-danger">{(decide.error as ApiError).message}</p>}
          {decide.isSuccess && <p role="status" className="m-0 text-primary">Decisão registrada.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={decide.isPending || just.trim().length < 5} onClick={() => decide.mutate('approve')}>Aprovar e publicar análise</button>
            <button type="button" className="btn btn-ghost" disabled={decide.isPending || just.trim().length < 5} onClick={() => decide.mutate('request_changes')}>Pedir ajustes</button>
            <button type="button" className="btn btn-danger" disabled={decide.isPending || just.trim().length < 5} onClick={() => decide.mutate('reject')}>Rejeitar</button>
          </div>
        </form>
      ) : <p className="text-sm text-muted">Esta versão não está em revisão (análises publicadas são imutáveis; correções geram nova versão).</p>}
      <section>
        <h3 className="kicker">Histórico de decisões</h3>
        <Table rows={reviews} cols={[['created_at', 'Data', (r) => fmtDateTime(r.created_at as string)], ['reviewer', 'Editor'], ['decision', 'Decisão'], ['justification', 'Justificativa']]} />
      </section>
    </div>
  );
}

function Editions() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const list = useAdmin<{ items: Row[] }>('/admin/editions');
  const preview = useQuery({ queryKey: ['admin', 'preview', date], queryFn: () => api<{ status: string; edition: { headline: { headline: string } | null; secondary: unknown[]; sections: unknown[] } }>(`/admin/editions/${date}/preview`), retry: false });
  const act = useMutation({
    mutationFn: (a: 'compose' | 'publish') => api(`/admin/editions/${date}/${a}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">Data da edição<input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" className="btn btn-ghost" onClick={() => act.mutate('compose')} disabled={act.isPending}>Compor rascunho</button>
        <button type="button" className="btn btn-primary" onClick={() => act.mutate('publish')} disabled={act.isPending}>Publicar rascunho</button>
      </div>
      {act.error && <p role="alert" className="m-0 text-danger">{(act.error as ApiError).message}</p>}
      <div className="border border-line bg-surface p-3 text-sm">
        <p className="kicker m-0 text-muted">Prévia ({preview.data?.status ?? 'sem edição'})</p>
        {preview.data ? <p className="m-0">Manchete: <strong>{preview.data.edition.headline?.headline ?? '—'}</strong> · {preview.data.edition.secondary.length} secundárias · {preview.data.edition.sections.length} seções</p> : <p className="m-0 text-muted">Sem rascunho para esta data.</p>}
      </div>
      {list.data && <Table rows={list.data.items} cols={[['edition_date', 'Data'], ['version', 'Versão'], ['status', 'Situação'], ['is_demo', 'Demo', (r) => (r.is_demo ? 'sim' : 'não')], ['items', 'Itens'], ['published_at', 'Publicada', (r) => (r.published_at ? fmtDateTime(r.published_at as string) : '—')]]} />}
    </div>
  );
}

function Jobs() {
  const qc = useQueryClient();
  const q = useAdmin<{ items: Row[]; runs: Row[] }>('/admin/jobs');
  const inv = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const run = useMutation({ mutationFn: () => api('/admin/ingestion/run', { method: 'POST', body: {} }), onSuccess: inv });
  const process = useMutation({ mutationFn: () => api<{ processed: number }>('/admin/jobs/process', { method: 'POST', body: { max: 5 } }), onSuccess: inv });
  const retry = useMutation({ mutationFn: (id: string) => api(`/admin/jobs/${id}/retry`, { method: 'POST' }), onSuccess: inv });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => run.mutate()} disabled={run.isPending}>Enfileirar ingestão PubMed (temas habilitados)</button>
        <button type="button" className="btn btn-primary" onClick={() => process.mutate()} disabled={process.isPending}>{process.isPending ? 'Processando…' : 'Processar fila agora (até 5)'}</button>
      </div>
      {(run.error || process.error) && <p role="alert" className="m-0 text-danger">{((run.error ?? process.error) as ApiError).message}</p>}
      {process.data && <p role="status" className="m-0 text-sm">{process.data.processed} job(s) processado(s).</p>}
      {q.data && (
        <>
          <h3 className="kicker m-0">Jobs</h3>
          <Table rows={q.data.items} cols={[['type', 'Tipo'], ['status', 'Situação'], ['attempts', 'Tentativas'], ['idempotency_key', 'Chave'], ['last_error', 'Último erro'], ['updated_at', 'Atualizado', (r) => fmtDateTime(r.updated_at as string)],
            ['id', '', (r) => (['failed', 'blocked'].includes(r.status as string) ? <button type="button" className="link" onClick={() => retry.mutate(r.id as string)}>Reprocessar</button> : null)]]} />
          <h3 className="kicker m-0">Execuções de ingestão</h3>
          <Table rows={q.data.runs} cols={[['topic', 'Tema'], ['status', 'Situação'], ['window_from', 'De'], ['window_to', 'Até'], ['found', 'Encontrados'], ['inserted', 'Novos'], ['duplicates', 'Duplicados'], ['error', 'Erro']]} />
        </>
      )}
    </div>
  );
}

function Simple({ path, cols }: { path: string; cols: [string, string, ((r: Row) => React.ReactNode)?][] }) {
  const q = useAdmin<{ items: Row[] }>(path);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return <Table rows={q.data!.items} cols={cols} />;
}

function Costs() {
  const q = useAdmin<{ pricing: { version: string | null; note: string }; byDay: Row[]; totals: Row; budget: Row }>('/admin/ai-usage');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  return (
    <div className="grid gap-3 text-sm">
      <p className="m-0">{d.pricing.note} Tabela: <code>{s(d.pricing.version)}</code> (USD).</p>
      <p className="m-0">Artigos processados: {s(d.totals.processed ?? 0)} · aprovados: {s(d.totals.approved ?? 0)} · custo estimado: {d.totals.cost_usd != null ? `US$ ${Number(d.totals.cost_usd).toFixed(4)}` : 'não calculado'} · limites: {s(d.budget.maxArticlesPerDay)} artigos/dia, diário US$ {s(d.budget.dailyUsd)}, mensal US$ {s(d.budget.monthlyUsd)}</p>
      <Table rows={d.byDay} cols={[['day', 'Dia'], ['task', 'Tarefa'], ['model', 'Modelo'], ['calls', 'Chamadas'], ['input_tokens', 'Entrada'], ['cached_tokens', 'Cache'], ['output_tokens', 'Saída'], ['articles', 'Artigos'], ['cost_usd', 'Custo est. (USD)', (r) => (r.cost_usd != null ? Number(r.cost_usd).toFixed(4) : 'sem preço')]]} />
    </div>
  );
}

function Flags() {
  const qc = useQueryClient();
  const q = useAdmin<{ items: Row[] }>('/admin/flags');
  const m = useMutation({ mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api(`/admin/flags/${key}`, { method: 'PATCH', body: { enabled } }), onSuccess: () => qc.invalidateQueries() });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="grid gap-2">
      {m.error && <p role="alert" className="m-0 text-danger">{(m.error as ApiError).message}</p>}
      {q.data!.items.map((f) => (
        <label key={s(f.key)} className="flex min-h-11 items-center gap-3 border-b border-line">
          <input type="checkbox" className="size-5" checked={f.enabled === 1} onChange={(e) => m.mutate({ key: f.key as string, enabled: e.target.checked })} />
          <code>{s(f.key)}</code><span className="text-sm text-muted">{s(f.description)}</span>
        </label>
      ))}
    </div>
  );
}

function Plans() {
  const qc = useQueryClient();
  const q = useAdmin<{ items: { id: string; name: string; priceCents: number; active: boolean }[] }>('/admin/plans');
  const m = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => api(`/admin/plans/${id}`, { method: 'PATCH', body }), onSuccess: () => qc.invalidateQueries() });
  if (q.isLoading) return <Loading />;
  return (
    <div className="grid gap-3">
      {q.data?.items.map((p) => (
        <form key={p.id} className="flex flex-wrap items-end gap-2 border-b border-line pb-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); m.mutate({ id: p.id, body: { name: fd.get('name'), priceCents: Math.round(Number(String(fd.get('price')).replace(',', '.')) * 100), active: fd.get('active') === 'on' } }); }}>
          <label className="grid gap-1 text-sm">Nome<input name="name" className="input" defaultValue={p.name} /></label>
          <label className="grid gap-1 text-sm">Preço (R$)<input name="price" className="input !w-32" defaultValue={(p.priceCents / 100).toFixed(2).replace('.', ',')} /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={p.active} /> Ativo</label>
          <button className="btn btn-ghost">Salvar</button>
          <span className="text-xs text-muted">Atual: {fmtBRL(p.priceCents)}</span>
        </form>
      ))}
      {m.error && <p role="alert" className="text-danger">{(m.error as ApiError).message}</p>}
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => api(`/admin/users/${id}`, { method: 'PATCH', body: { role } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  return (
    <>
      {m.error && <p role="alert" className="text-danger">{(m.error as ApiError).message}</p>}
      <Simple path="/admin/users" cols={[['email', 'E-mail'], ['status', 'Situação'], ['created_at', 'Criado', (r) => fmtDateTime(r.created_at as string)],
        ['role', 'Papel', (r) => (
          <select className="input !min-h-9 !w-auto" value={r.role as string} onChange={(e) => m.mutate({ id: r.id as string, role: e.target.value })} aria-label={`Papel de ${s(r.email)}`}>
            <option value="reader">leitor</option><option value="editor">editor</option><option value="admin">admin</option>
          </select>
        )]]} />
    </>
  );
}

const TABS: [string, string, 'editor' | 'admin'][] = [
  ['', 'Visão geral', 'editor'], ['revisao', 'Revisão', 'editor'], ['edicoes', 'Edições', 'editor'], ['jobs', 'Ingestão e jobs', 'editor'],
  ['fontes', 'Fontes', 'editor'], ['custos', 'Custos de IA', 'editor'], ['relatos', 'Relatos', 'editor'],
  ['flags', 'Flags', 'admin'], ['planos', 'Planos', 'admin'], ['usuarios', 'Usuários', 'admin'], ['auditoria', 'Auditoria', 'admin'],
];

export default function Admin() {
  const me = useMe();
  const rest = useParams()['*'] ?? '';
  const [tab, id] = rest.split('/');
  if (me.isLoading) return <div className="mx-auto max-w-6xl px-4"><Loading /></div>;
  if (!me.data) return <Navigate to="/entrar" replace />;
  if (me.data.role === 'reader') return <div className="mx-auto max-w-6xl px-4"><Empty title="Acesso restrito à equipe editorial" /></div>;
  const tabs = TABS.filter((t) => t[2] === 'editor' || me.data!.role === 'admin');
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pt-4 pb-2">
        <h1 className="m-0 font-serif text-3xl font-bold">Painel editorial</h1>
        <p className="m-0 text-sm text-muted">Área interna · {me.data.email} ({me.data.role})</p>
      </header>
      <nav aria-label="Seções do painel" className="mb-6 border-b border-line"><ScrollRow className="flex" label="abas">
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={`/admin${path ? `/${path}` : ''}`} end className={({ isActive }) => `min-h-11 whitespace-nowrap border-b-2 px-3 py-3 text-sm ${isActive || (path && tab === path) ? 'border-ink font-semibold' : 'border-transparent text-muted'}`}>{label}</NavLink>
        ))}
      </ScrollRow></nav>
      {!tab && <Overview />}
      {tab === 'revisao' && (id ? <ReviewDetail id={id} /> : <Reviews />)}
      {tab === 'edicoes' && <Editions />}
      {tab === 'jobs' && <Jobs />}
      {tab === 'fontes' && <Simple path="/admin/sources" cols={[['name', 'Fonte'], ['status', 'Situação'], ['enabled', 'Ativa', (r) => (r.enabled ? 'sim' : 'não')], ['last_success_at', 'Último sucesso', (r) => (r.last_success_at ? fmtDateTime(r.last_success_at as string) : '—')], ['last_error', 'Último erro'], ['license_notes', 'Licença/termos']]} />}
      {tab === 'custos' && <Costs />}
      {tab === 'relatos' && <Simple path="/admin/reports" cols={[['original_title', 'Artigo', (r) => <Link className="link" to={`/artigos/${s(r.slug)}`}>{s(r.original_title)}</Link>], ['message', 'Relato'], ['status', 'Situação'], ['created_at', 'Data', (r) => fmtDateTime(r.created_at as string)]]} />}
      {tab === 'flags' && <Flags />}
      {tab === 'planos' && <Plans />}
      {tab === 'usuarios' && <Users />}
      {tab === 'auditoria' && <Simple path="/admin/audit" cols={[['created_at', 'Data', (r) => fmtDateTime(r.created_at as string)], ['actor', 'Ator'], ['action', 'Ação'], ['target_type', 'Alvo'], ['detail', 'Detalhe']]} />}
    </div>
  );
}
