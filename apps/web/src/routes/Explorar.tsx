import { Link, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designLabels, studyDesigns, type ArticleCard, type Paged, type Source } from '@jm/contracts';
import { api, useMe, useTopics } from '../lib/api';
import { ListRow } from '../components/ArticleCard';
import { Empty, ErrorState, Loading, PageTitle } from '../components/ui';

export default function Explorar() {
  const { area, subarea, slug: temaSlug } = useParams();
  const slug = temaSlug ?? subarea ?? area ?? '';
  const [sp, setSp] = useSearchParams();
  const topics = useTopics();
  const me = useMe();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<Source[]>('/sources') });
  const filters = { design: sp.get('desenho') ?? '', days: sp.get('periodo') ?? '', source: sp.get('fonte') ?? '', sort: sp.get('ordem') ?? 'recent', q: sp.get('q') ?? '' };
  const topic = topics.data?.find((t) => t.slug === slug);

  const list = useInfiniteQuery({
    queryKey: ['articles', slug, filters],
    enabled: !!topic?.enabled,
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ topic: slug, sort: filters.sort, limit: '15' });
      if (filters.design) qs.set('design', filters.design);
      if (filters.days) qs.set('days', filters.days);
      if (filters.source) qs.set('source', filters.source);
      if (filters.q) qs.set('q', filters.q);
      if (pageParam) qs.set('cursor', pageParam);
      return api<Paged<ArticleCard>>(`/articles?${qs}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const following = !!me.data?.preferences.topics.includes(slug);
  const follow = useMutation({
    mutationFn: () => api(`/topics/${slug}/follow`, { method: 'POST', body: { follow: !following } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  if (topics.isLoading) return <div className="mx-auto max-w-6xl px-4"><Loading /></div>;
  if (!topic) return <div className="mx-auto max-w-6xl px-4"><Empty title="Seção não encontrada"><Link to="/jornal" className="link">Voltar ao jornal</Link></Empty></div>;

  const chain = [];
  let cur: typeof topic | undefined = topic;
  while (cur) { chain.unshift(cur); cur = topics.data!.find((x) => x.slug === cur!.parentSlug); }
  const children = topics.data!.filter((t) => t.parentSlug === slug);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      <nav aria-label="Trilha" className="scroll-x py-3 text-sm text-muted">
        <ol className="m-0 flex list-none gap-1.5 p-0 whitespace-nowrap">
          <li><Link to="/jornal" className="hover:underline">Jornal</Link></li>
          {chain.map((c, i) => <li key={c.slug}>/ {i === chain.length - 1 ? <span aria-current="page">{c.label}</span> : <Link to={i === 0 ? `/areas/${c.slug}` : `/temas/${c.slug}`} className="hover:underline">{c.label}</Link>}</li>)}
        </ol>
      </nav>
      <PageTitle kicker={topic.level === 'area' ? 'Área' : topic.level === 'subarea' ? 'Subárea' : 'Tema'} title={topic.label}>
        {topic.enabled && me.data && (
          <button type="button" className={`btn mt-2 ${following ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={following} onClick={() => follow.mutate()} disabled={follow.isPending}>
            {following ? 'Seguindo' : 'Seguir este tema'}
          </button>
        )}
      </PageTitle>

      {!topic.enabled ? (
        <Empty title="Seção em preparação">
          Esta área está na taxonomia, mas ainda não tem fontes e filtros configurados. Não exibimos conteúdo até haver cobertura real e revisão editorial.
        </Empty>
      ) : (
        <>
          {children.length > 0 && (
            <nav aria-label="Subdivisões" className="mb-4 flex flex-wrap gap-2">
              {children.map((c) => (
                <Link key={c.slug} to={`/temas/${c.slug}`} className={`chip !text-sm ${c.enabled ? '!text-ink' : ''}`}>{c.label}{!c.enabled && ' · em preparação'}</Link>
              ))}
            </nav>
          )}
          <form className="mb-2 grid gap-2 border-y border-line py-3 sm:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
            <label className="grid gap-1 text-xs font-semibold text-muted">Tipo de estudo
              <select className="input !min-h-10 text-sm" value={filters.design} onChange={(e) => set('desenho', e.target.value)}>
                <option value="">Todos</option>
                {studyDesigns.map((d) => <option key={d} value={d}>{designLabels[d]}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-muted">Período
              <select className="input !min-h-10 text-sm" value={filters.days} onChange={(e) => set('periodo', e.target.value)}>
                <option value="">Todo o acervo</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="365">Último ano</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-muted">Fonte
              <select className="input !min-h-10 text-sm" value={filters.source} onChange={(e) => set('fonte', e.target.value)}>
                <option value="">Todas</option>
                {(sources.data ?? []).filter((s) => s.enabled).map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-muted">Ordenar por
              <select className="input !min-h-10 text-sm" value={filters.sort} onChange={(e) => set('ordem', e.target.value)}>
                <option value="recent">Mais recentes</option><option value="priority">Prioridade editorial</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-muted">Buscar no acervo
              <input className="input !min-h-10 text-sm" type="search" defaultValue={filters.q} onKeyDown={(e) => { if (e.key === 'Enter') set('q', (e.target as HTMLInputElement).value); }} onBlur={(e) => set('q', e.target.value)} placeholder="Título ou manchete" />
            </label>
          </form>
          {list.isLoading && <Loading />}
          {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
          {!list.isLoading && !list.error && items.length === 0 && <Empty title="Nenhum estudo com esses filtros">Tente ampliar o período ou limpar os filtros.</Empty>}
          <ul className="m-0 list-none p-0">{items.map((a) => <ListRow key={a.id} a={a} />)}</ul>
          {list.hasNextPage && (
            <button type="button" className="btn btn-ghost mt-4" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
