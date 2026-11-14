import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MonitorDto, MonitorSource, MonitoredDocument } from '@jm/contracts';
import { api, fmtDateTime, useMe } from '../lib/api';
import { Empty, ErrorState, Loading, PageTitle } from '../components/ui';

function documentDate(date: string | null) {
  if (!date) return 'não informada pela fonte';
  const parts = date.split('-');
  return parts.reverse().join('/');
}
function OfficialForm({ sources }: { sources: MonitorSource[] }) {
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/admin/monitor/documents', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitor'] }),
  });
  return <details className="my-6 border-y border-line py-3">
    <summary className="min-h-11 cursor-pointer font-semibold">Cadastrar documento oficial (equipe editorial)</summary>
    <p className="max-w-prose text-sm text-muted">Transcreva título e ementa da fonte oficial. Este cadastro exibe metadados, sem análise jurídica ou confirmação de vigência.</p>
    <form className="grid max-w-3xl gap-4 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      save.mutate({ ...Object.fromEntries(form), date: form.get('date') || null, confirmedVerbatim: confirmed });
    }}>
      <label className="grid gap-1 text-sm">Órgão<select name="source" className="input" required>{sources.filter((s) => s.mode === 'reference').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Identificação (tipo, número e ano)<input name="identifier" className="input" required minLength={2} maxLength={150} /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Título oficial<input name="title" className="input" required minLength={5} maxLength={500} /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Ementa ou trecho literal<textarea name="description" className="input min-h-28 py-2" required minLength={10} maxLength={6000} /></label>
      <label className="grid gap-1 text-sm">Data do documento (se informada)<input name="date" type="date" className="input" /></label>
      <label className="grid gap-1 text-sm">Link oficial HTTPS<input name="url" type="url" className="input" required maxLength={2000} /></label>
      <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />Conferi a fonte oficial e transcrevi o conteúdo sem interpretação ou alteração.</label>
      <button className="btn btn-primary w-fit" disabled={!confirmed || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar documento oficial'}</button>
      {save.isSuccess && <p role="status">Documento cadastrado.</p>}
      {save.error && <div className="sm:col-span-2"><ErrorState error={save.error} /></div>}
    </form>
  </details>;
}

export default function Monitor({ kind }: { kind: MonitoredDocument['kind'] }) {
  const isRegulation = kind === 'regulation';
  const me = useMe();
  const staff = !!me.data && me.data.role !== 'reader';
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [technology, setTechnology] = useState(false);
  const [limit, setLimit] = useState(30);
  const q = useQuery({ queryKey: ['monitor', kind], queryFn: () => api<MonitorDto>(`/monitor?kind=${kind}`) });
  const sync = useMutation({ mutationFn: (source: string) => api('/admin/monitor/sync', { method: 'POST', body: { source } }) });
  const sources = q.data?.sources ?? [];
  const items = (q.data?.items ?? []).filter((r) => (!source || r.source === source) && (!technology || r.technology) && `${r.title} ${r.description ?? ''} ${r.identifier}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <div className="mx-auto max-w-6xl px-4 pb-10">
    <PageTitle title={isRegulation ? 'Saúde pública e regulação' : 'Publicações científicas'}>
      {isRegulation
        ? 'Documentos oficiais da saúde brasileira: portarias, leis, proposições e tecnologias em saúde.'
        : 'Descoberta bibliográfica de NEJM, JAMA, The Lancet e The BMJ, com metadados depositados no Crossref.'}
    </PageTitle>
    <nav aria-label="Acervos" className="article-jump mb-5">
      <Link to="/regulacao" aria-current={isRegulation ? 'page' : undefined}>Saúde pública e regulação</Link>
      <Link to="/publicacoes" aria-current={!isRegulation ? 'page' : undefined}>Publicações científicas</Link>
      <Link to="/jornal">Análises de estudos</Link>
    </nav>
    <p className="max-w-prose text-sm text-muted">
      {isRegulation
        ? 'Cobertura parcial federal. A coleta automática reúne proposições da Câmara classificadas em Saúde; os demais órgãos têm consulta oficial e cadastro editorial. Propostas não são leis em vigor. Vigência, revogações e efeitos devem ser conferidos no documento original.'
        : 'Estes registros ainda não são análises revisadas. Podem incluir cartas e editoriais. O acesso ao texto completo depende do editor; a inclusão nesta lista não certifica a qualidade do estudo.'}
    </p>
    {q.isLoading && <Loading />}
    {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
    {q.data && <>
      <details className="my-5 border-y border-line py-3">
        <summary className="min-h-11 cursor-pointer font-semibold">Fontes e cobertura · {sources.length} canais</summary>
        <ul className="m-0 list-none p-0">{sources.map((s) => <li key={s.id} className="grid gap-2 border-t border-line py-4 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="link font-semibold">{s.name} · abrir fonte oficial</a>
            <p className="m-0 mt-1 max-w-prose text-sm text-muted">{s.scope}</p>
            <p className="m-0 mt-1 text-xs text-muted">{s.mode === 'reference' ? 'Consulta oficial · cadastro editorial' : s.lastSuccessAt ? `Última coleta: ${fmtDateTime(s.lastSuccessAt)}` : 'Coleta automática · aguardando primeira execução'}</p>
            {s.error && <p role="status" className="m-0 text-sm text-warning">{s.error} Os registros anteriores continuam disponíveis.</p>}
          </div>
          {staff && s.mode === 'automatic' && <button className="btn btn-ghost h-fit" disabled={sync.isPending} onClick={() => sync.mutate(s.id)}>Agendar coleta</button>}
        </li>)}</ul>
        {sync.isSuccess && <p role="status">Coleta enfileirada. <Link to="/admin/jobs" className="link">Acompanhar execução</Link></p>}
        {sync.error && <ErrorState error={sync.error} />}
      </details>
      {staff && isRegulation && <OfficialForm sources={sources} />}
      <div className="my-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_auto]">
        <label className="grid gap-1 text-sm font-medium">Fonte<select className="input" value={source} onChange={(e) => { setSource(e.target.value); setLimit(30); }}><option value="">Todas as fontes</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Buscar por assunto ou identificação<input type="search" className="input" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(30); }} placeholder={isRegulation ? 'Ex.: telessaúde, SUS, portaria' : 'Título ou DOI'} /></label>
        {isRegulation && <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input className="size-5" type="checkbox" checked={technology} onChange={(e) => { setTechnology(e.target.checked); setLimit(30); }} />Tecnologia em saúde</label>}
      </div>
      {technology && <p className="text-sm text-muted">Filtro por termos na identificação e ementa, incluindo saúde digital, telemedicina, dispositivos e inteligência artificial. A classificação pode não alcançar todos os documentos do tema.</p>}
      <p role="status" className="text-sm text-muted">{items.length} {items.length === 1 ? 'registro encontrado' : 'registros encontrados'}{items.length > limit ? ` · mostrando ${limit}` : ''}.</p>
      {!items.length && <Empty title="Nenhum documento disponível com estes filtros">Amplie a busca ou abra “Fontes e cobertura” para consultar os portais oficiais. Uma lista vazia não significa ausência de novos atos.</Empty>}
      <ul className="m-0 list-none p-0">{items.slice(0, limit).map((r) => <li key={r.id} className="border-t border-line py-5">
        <p className="m-0 mb-1 text-sm font-medium text-primary">{sources.find((s) => s.id === r.source)?.name}</p>
        <h2 lang={isRegulation ? undefined : 'en'} className="m-0 max-w-prose font-serif text-xl font-bold sm:text-2xl"><a className="headline-link hover:underline" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a></h2>
        {r.description && <div className="my-3 max-w-[75ch]"><p className="m-0 text-xs font-semibold text-muted">Ementa ou trecho da fonte</p><p className="m-0 mt-1 leading-relaxed">{r.description}</p></div>}
        <p className="m-0 mt-2 text-sm text-muted">{r.dateLabel}: {documentDate(r.date)}</p>
        <p className="m-0 mt-1 text-sm text-warning">{r.stage}</p>
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="link mt-2 inline-flex min-h-11 items-center text-sm">Abrir {isRegulation ? 'documento na fonte oficial' : 'publicação pelo DOI'} (nova aba)</a>
      </li>)}</ul>
      {items.length > limit && <button className="btn btn-ghost" onClick={() => setLimit((v) => v + 30)}>Carregar mais registros</button>}
    </>}
  </div>;
}
