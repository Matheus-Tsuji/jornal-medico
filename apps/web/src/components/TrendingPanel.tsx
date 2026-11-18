// "Em alta": temas com mais estudos na edição (no estilo "o que está acontecendo" das redes) e, quando há leitores
// suficientes, os mais lidos do mês. Tudo vem de dados reais: contagem da edição e o ranking com mínimo de leitores.
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ArticleCard } from '@jm/contracts';
import { api } from '../lib/api';

type Ranked = ArticleCard & { readers: number };

export default function TrendingPanel({ items }: { items: ArticleCard[] }) {
  const ranking = useQuery({ queryKey: ['rankings'], queryFn: () => api<{ items: Ranked[] }>('/rankings/monthly') });

  const byTopic = new Map<string, { topic: ArticleCard['topics'][number]; count: number; best: string; top: ArticleCard }>();
  for (const a of items) {
    const t = a.topics[0];
    if (!t) continue;
    const cur = byTopic.get(t.slug);
    const grade = a.evidence?.grade ?? 'C3';
    if (!cur) byTopic.set(t.slug, { topic: t, count: 1, best: grade, top: a });
    else { cur.count++; if (grade < cur.best) { cur.best = grade; cur.top = a; } }
  }
  const trends = [...byTopic.values()].sort((a, b) => b.count - a.count || a.best.localeCompare(b.best)).slice(0, 7);
  const read = (ranking.data?.items ?? []).slice(0, 5);

  return (
    <aside aria-labelledby="em-alta" className="trending grid content-start gap-1">
      <h2 id="em-alta" className="kicker m-0 mb-2 border-b border-ink pb-1 text-ink">Em alta</h2>
      <ol className="m-0 grid list-none p-0">
        {trends.map((t, i) => (
          <li key={t.topic.slug}>
            <Link to={`/artigos/${t.top.slug}`} className="trend-row">
              <span className="text-xs text-muted">{i + 1} · Em alta em <span className="topic-text" style={{ '--topic': t.topic.color ?? undefined } as React.CSSProperties}>{t.topic.label}</span></span>
              <span className="trend-title">{t.top.headline}</span>
              <span className="tnum text-xs text-muted">{t.count} {t.count === 1 ? 'estudo' : 'estudos'} na capa · melhor nota {t.best}</span>
            </Link>
          </li>
        ))}
      </ol>
      {read.length > 0 && (
        <>
          <h3 className="kicker m-0 mt-5 mb-1 text-muted">Mais lidos do mês</h3>
          <ol className="m-0 grid list-none p-0">
            {read.map((a, i) => (
              <li key={a.id}>
                <Link to={`/artigos/${a.slug}`} className="trend-row">
                  <span className="trend-title"><span className="tnum mr-1.5 text-muted">{i + 1}</span>{a.headline}</span>
                  <span className="tnum text-xs text-muted">{a.readers} leitores</span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
