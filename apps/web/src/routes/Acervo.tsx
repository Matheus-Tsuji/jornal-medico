import { Link, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ArticleCard, EditionSummary } from '@jm/contracts';
import { api, fmtLongDate, useMe } from '../lib/api';
import { ListRow } from '../components/ArticleCard';
import { Empty, ErrorState, Loading, PageTitle } from '../components/ui';

function PersonalList({ path, title, empty, kicker }: { path: string; title: string; empty: string; kicker: string }) {
  const me = useMe();
  const q = useQuery({ queryKey: [path, me.data?.id], enabled: !!me.data, queryFn: () => api<{ items: ArticleCard[] }>(path) });
  if (me.isLoading) return <Wrap><Loading /></Wrap>;
  if (!me.data) return <Navigate to="/entrar" replace />;
  return (
    <Wrap>
      <PageTitle kicker={kicker} title={title} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <Empty title={empty}><Link to="/jornal" className="link">Ir para a edição de hoje</Link></Empty>}
      <ul className="m-0 list-none p-0">{q.data?.items.map((a) => <ListRow key={a.id} a={a} />)}</ul>
    </Wrap>
  );
}

const Wrap = ({ children }: { children: React.ReactNode }) => <div className="mx-auto max-w-4xl px-4 pb-10">{children}</div>;

export const Salvos = () => <PersonalList path="/bookmarks" kicker="Acervo pessoal" title="Salvos" empty="Você ainda não salvou nenhum estudo" />;
export const Historico = () => <PersonalList path="/history" kicker="Acervo pessoal" title="Histórico de leitura" empty="Nenhuma leitura registrada" />;

export function Edicoes() {
  const q = useQuery({ queryKey: ['editions'], queryFn: () => api<{ items: EditionSummary[] }>('/editions') });
  return (
    <Wrap>
      <PageTitle kicker="Arquivo" title="Edições anteriores">Cada edição preserva sua composição original; avisos de correção e retratação aparecem atualizados.</PageTitle>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <Empty title="Nenhuma edição publicada ainda" />}
      <ul className="m-0 list-none p-0">
        {q.data?.items.map((e) => (
          <li key={e.date} className="border-t border-line py-4">
            <Link to={`/edicoes/${e.date}`} className="headline-link grid gap-1">
              <span className="kicker text-muted">Edição nº {e.number} · {e.items} {e.items === 1 ? 'estudo' : 'estudos'}{e.isDemo ? ' · demonstração' : ''}</span>
              <h2 className="m-0 font-serif text-xl font-bold first-letter:uppercase">{fmtLongDate(e.date)}</h2>
              {e.headline && <span className="text-muted">{e.headline}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Wrap>
  );
}

export function MaisLidos() {
  const q = useQuery({ queryKey: ['rankings'], queryFn: () => api<{ criterion: string; month: string; items: (ArticleCard & { readers: number })[] }>('/rankings/monthly') });
  return (
    <Wrap>
      <PageTitle kicker="Ranking do mês" title="Mais lidos">{q.data?.criterion}</PageTitle>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <Empty title="Ainda não há leitores suficientes neste mês">O ranking só aparece quando cada estudo atinge o número mínimo de leitores únicos, para não expor a leitura de poucas pessoas.</Empty>}
      <ol className="m-0 list-none p-0">
        {q.data?.items.map((a, i) => (
          <li key={a.id} className="grid grid-cols-[2.5rem_1fr] items-start">
            <span className="tnum pt-4 font-serif text-2xl font-bold text-muted">{i + 1}</span>
            <ul className="m-0 list-none p-0"><ListRow a={a} /></ul>
          </li>
        ))}
      </ol>
    </Wrap>
  );
}
