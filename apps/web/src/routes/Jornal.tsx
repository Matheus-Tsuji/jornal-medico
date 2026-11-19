import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { EditionDto } from '@jm/contracts';
import { api, fmtDate, fmtLongDate, useMe } from '../lib/api';
import { CompactStory, LeadStory, SecondaryStory } from '../components/ArticleCard';
import { DemoBanner, Empty, ErrorState, Loading } from '../components/ui';
import TrendingPanel from '../components/TrendingPanel';


export default function Jornal() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('edition-strip')); }, []);
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
          Nenhum estudo foi aprovado pela equipe editorial até agora. Preferimos uma edição curta a completar a página com conteúdo sem revisão.
        </Empty>
      </div>
    );
  }
  // Faixa fina acima do cabeçalho (slot no Layout): só a data e o total do dia, sem destaque.
  const editionLine = (
    <div className="tnum mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-1.5 text-xs text-muted">
      <span className="first-letter:uppercase">{fmtLongDate(e.date)}</span>
      {e.todayCount !== undefined && <span>{e.todayCount} {e.todayCount === 1 ? 'estudo analisado' : 'estudos analisados'} hoje</span>}
    </div>
  );
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const all = [e.headline, ...e.secondary, ...e.sections.flatMap((s) => s.items)].filter((x): x is NonNullable<typeof x> => !!x);
  // Para você: a seleção pessoal (ou geral, sem login); a manchete abre quando não há seleção.
  const picks = e.forYou.length ? e.forYou : [e.headline, ...e.secondary].filter((x): x is NonNullable<typeof x> => !!x);
  const [forYouLead, ...rest] = picks;
  const forYouRest = rest.slice(0, 4);
  const shown = new Set([forYouLead, ...forYouRest].map((a) => a?.id));
  const more = [e.headline, ...e.secondary].filter((x): x is NonNullable<typeof x> => !!x && !shown.has(x.id)).slice(0, 8);

  return (
    <>
      {e.isDemo && <DemoBanner />}
      <div className="mx-auto max-w-6xl px-4">
        {slot && createPortal(editionLine, slot)}
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


        {/* Para você (esquerda) + Em alta (direita, no estilo "o que está acontecendo") */}
        <section className="grid gap-8 py-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="para-voce" className="lg:border-r lg:border-line lg:pr-8">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-1">
              <h2 id="para-voce" className="kicker m-0 text-ink">Para você</h2>
              <p className="m-0 text-xs text-muted">
                {me.data ? <>Pelos seus interesses · <Link to="/configuracoes" className="link">Ajustar</Link></> : <>Seleção geral · <Link to="/entrar" className="link">Entre para personalizar</Link></>}
              </p>
            </div>
            {forYouLead ? <LeadStory a={forYouLead} reasons={'reasons' in forYouLead ? (forYouLead as { reasons?: string[] }).reasons : undefined} /> : <p className="text-muted">Sem estudos nesta edição.</p>}
            {forYouRest.length > 0 && (
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                {forYouRest.map((a) => <div key={a.id} className="rule-top pt-4"><CompactStory a={a} reasons={a.reasons} /></div>)}
              </div>
            )}
          </section>
          <TrendingPanel items={all} />
        </section>

        {/* Também nesta edição: leitura rápida das demais escolhas da edição */}
        {more.length > 0 && (
          <section aria-labelledby="tambem" className="rule-strong py-6">
            <h2 id="tambem" className="kicker m-0 mb-4 text-ink">Também nesta edição</h2>
            <ol className="m-0 grid list-none gap-x-8 gap-y-4 p-0 md:grid-cols-2">
              {more.map((a, i) => (
                <li key={a.id} className="grid grid-cols-[1.75rem_1fr] gap-2">
                  <span className="tnum font-serif text-xl font-bold text-muted" aria-hidden>{i + 1}</span>
                  <p className="m-0 leading-snug">
                    <Link to={`/artigos/${a.slug}`} className="font-semibold hover:underline">{a.headline}</Link>
                    {a.evidence && <span className="ml-1.5 align-middle text-xs font-bold text-primary">{a.evidence.grade}</span>}
                  </p>
                </li>
              ))}
            </ol>
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
          {e.isPreview ? 'Fim da prévia de ' : 'Fim da edição de '}{fmtDate(e.date, { day: 'numeric', month: 'long' })}
        </p>
      </div>
    </>
  );
}
