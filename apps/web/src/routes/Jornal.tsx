import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { EditionDto } from '@jm/contracts';
import { api, fmtDate, fmtDateTime, fmtLongDate, useMe } from '../lib/api';
import { CompactStory, LeadStory, SecondaryStory } from '../components/ArticleCard';
import { DemoBanner, Empty, ErrorState, Loading, PreviewBanner } from '../components/ui';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default function Jornal() {
  const { date } = useParams();
  const me = useMe();
  const q = useQuery({
    queryKey: ['edition', date ?? 'latest', me.data?.id ?? 'anon'],
    queryFn: () => api<{ edition: EditionDto | null }>(date ? `/editions/${date}` : '/editions/latest'),
  });

  if (q.isLoading) return <div className="mx-auto max-w-6xl px-4"><Loading label="Carregando a edição" lines={6} /></div>;
  if (q.error) return <div className="mx-auto max-w-6xl px-4"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const e = q.data?.edition;
  if (!e) {
    return (
      <div className="mx-auto max-w-6xl px-4">
        <Empty title="Ainda não há edição publicada">
          Nenhum estudo foi aprovado pela equipe editorial até agora. Preferimos uma edição curta a completar a página com conteúdo sem revisão. <Link to="/edicoes" className="link">Ver edições anteriores</Link>.
        </Empty>
      </div>
    );
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const all = [e.headline, ...e.secondary, ...e.sections.flatMap((s) => s.items)].filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <>
      {e.isDemo && <DemoBanner />}
      {e.isPreview && <PreviewBanner />}
      <div className="mx-auto max-w-6xl px-4">
        {/* Linha da edição */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-3 text-sm">
          <p className="m-0">
            {me.data && !date && <span className="text-muted">{greeting()}. </span>}
            <strong className="font-semibold first-letter:uppercase">{fmtLongDate(e.date)}</strong>
            <span className="text-muted"> · {e.isPreview ? 'Prévia automática (não é edição publicada)' : `Edição nº ${e.number}${e.version > 1 ? ` (versão ${e.version})` : ''}`}</span>
          </p>
          <p className="tnum m-0 text-muted">
            {all.length} {all.length === 1 ? 'estudo' : 'estudos'}
            {e.isPreview && e.freshCount !== undefined && <> ({e.freshCount} {e.freshCount === 1 ? 'novo' : 'novos'} nas últimas 36 h)</>} · cerca de {e.totalReadingMinutes} min de leitura
            {e.publishedAt && <> · publicada {fmtDateTime(e.publishedAt)}</>}
          </p>
        </div>
        {date && date !== today && (
          <p className="m-0 border-b border-line py-2 text-sm text-muted">
            Você está lendo uma edição anterior. Avisos de correção ou retratação aparecem atualizados. <Link to="/jornal" className="link">Ir para a edição mais recente</Link>
          </p>
        )}
        {!date && !e.isPreview && e.date !== today && (
          <p className="m-0 border-b border-line py-2 text-sm text-muted">
            A edição de hoje ainda não foi publicada; esta é a mais recente disponível.
          </p>
        )}
        {e.coverageNote && !e.isDemo && !e.isPreview && <p className="m-0 border-b border-line py-2 text-sm text-warning">{e.coverageNote}</p>}

        <nav aria-label="Nesta edição" className="article-jump">
          <a href="#briefing">Ler o resumo da edição</a>
          <a href="#destaques">Ver os destaques</a>
          {e.forYou.length > 0 && <a href="#para-voce">Ir para sua seleção</a>}
        </nav>

        {/* Capa: manchete + coluna secundária */}
        <section id="destaques" aria-label="Destaques" className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="lg:border-r lg:border-line lg:pr-8">{e.headline ? <LeadStory a={e.headline} /> : <p className="text-muted">Sem manchete nesta edição.</p>}</div>
          {e.secondary.length > 0 && (
            <div className="grid content-start gap-6">
              <h2 className="kicker m-0 border-b border-ink pb-1 text-ink">Também nesta edição</h2>
              {e.secondary.map((a, i) => (
                <div key={a.id} className={i ? 'rule-top pt-5' : ''}><SecondaryStory a={a} /></div>
              ))}
            </div>
          )}
        </section>

        {/* Em 1 minuto */}
        <section aria-labelledby="briefing" className="rule-strong grid gap-4 py-6 md:grid-cols-[12rem_1fr]">
          <h2 id="briefing" className="m-0 font-serif text-2xl font-bold">Em 1 minuto</h2>
          <ol className="m-0 grid list-none gap-3 p-0">
            {all.map((a, i) => (
              <li key={a.id} className="grid grid-cols-[2rem_1fr] gap-2">
                <span className="tnum font-serif text-xl font-bold text-muted" aria-hidden>{i + 1}</span>
                <p className="m-0 leading-snug">
                  <Link to={`/artigos/${a.slug}`} className="font-semibold hover:underline">{a.headline}</Link>
                  {a.inShort && <span className="text-muted"> — {a.inShort}</span>}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Para você (seleção pessoal, separada da seleção editorial) */}
        {e.forYou.length > 0 && (
          <section aria-labelledby="para-voce" className="rule-strong py-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="para-voce" className="m-0 font-serif text-2xl font-bold">Para você</h2>
              <p className="m-0 text-sm text-muted">
                {me.data ? <>Ordenado pelos seus interesses. <Link to="/configuracoes" className="link">Ajustar</Link></> : <>Seleção geral. <Link to="/entrar" className="link">Entre para personalizar</Link></>}
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {e.forYou.map((a) => <div key={a.id} className="rule-top pt-3"><CompactStory a={a} reasons={a.reasons} /></div>)}
            </div>
          </section>
        )}

        {/* Seções temáticas */}
        {e.sections.map((s) => (
          <section key={s.topic.slug} aria-labelledby={`sec-${s.topic.slug}`} className="py-6">
            <div className="topic-rule mb-4 flex items-baseline justify-between pt-2" style={{ '--topic': s.topic.color ?? undefined } as React.CSSProperties}>
              <h2 id={`sec-${s.topic.slug}`} className="topic-text m-0 font-serif text-2xl font-bold">{s.topic.label}</h2>
              <Link to={`/temas/${s.topic.slug}`} className="link text-sm">Ver a seção</Link>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {s.items.map((a) => <SecondaryStory key={a.id} a={a} showResult={false} />)}
            </div>
          </section>
        ))}

        <p className="rule-top m-0 py-6 text-center text-sm text-muted">
          {e.isPreview ? 'Fim da prévia de ' : 'Fim da edição de '}{fmtDate(e.date, { day: 'numeric', month: 'long' })}. <Link to="/edicoes" className="link">Edições anteriores</Link>
        </p>
      </div>
    </>
  );
}
