import { Link } from 'react-router';
import { Bookmark, Check, Clock } from 'lucide-react';
import { designLabels, type ArticleCard as Card } from '@jm/contracts';
import { fmtDate } from '../lib/api';
import { KeyResultPanel, ResultLine, StatusChips, TopicKicker } from './ui';

function Meta({ a }: { a: Card }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>{a.journal ?? a.sourceName}</span>
      <span>{fmtDate(a.pubDate)}</span>
      <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />{a.readingMinutes} min</span>
      {a.bookmarked && <span className="inline-flex items-center gap-1"><Bookmark size={12} aria-hidden />Salvo</span>}
      {a.read && <span className="inline-flex items-center gap-1"><Check size={12} aria-hidden />Lido</span>}
    </p>
  );
}

export function LeadStory({ a, reasons }: { a: Card; reasons?: string[] }) {
  return (
    <article className="grid gap-3" aria-labelledby={`h-${a.id}`}>
      <TopicKicker topics={a.topics} extra={designLabels[a.studyDesign]} />
      {reasons && reasons.length > 0 && <p className="m-0 text-xs text-accent">{reasons.join(' · ')}</p>}
      <Link to={`/artigos/${a.slug}`} className="headline-link">
        <h2 id={`h-${a.id}`} className="m-0 font-serif text-[2rem] leading-[1.08] font-bold tracking-tight text-balance sm:text-[2.6rem] lg:text-[2.9rem]">
          {a.headline}
        </h2>
      </Link>
      {a.inShort && <p className="m-0 max-w-[60ch] font-serif text-lg leading-relaxed text-ink/90">{a.inShort}</p>}
      <StatusChips a={a} />
      {a.keyResult && <KeyResultPanel k={a.keyResult} evidence={a.evidence} design={a.studyDesign} />}
      <Meta a={a} />
      <Link to={`/artigos/${a.slug}`} className="link w-fit text-sm font-semibold">Ler a análise completa</Link>
    </article>
  );
}

export function SecondaryStory({ a, showResult = true }: { a: Card; showResult?: boolean }) {
  return (
    <article className="grid gap-2" aria-labelledby={`h-${a.id}`}>
      <TopicKicker topics={a.topics} extra={designLabels[a.studyDesign]} />
      <Link to={`/artigos/${a.slug}`} className="headline-link">
        <h3 id={`h-${a.id}`} className="m-0 font-serif text-xl leading-snug font-bold text-balance">{a.headline}</h3>
      </Link>
      {a.inShort && <p className="m-0 text-[0.95rem] leading-relaxed text-muted">{a.inShort}</p>}
      <StatusChips a={a} />
      {a.keyResult && (showResult ? <KeyResultPanel k={a.keyResult} evidence={a.evidence} design={a.studyDesign} compact /> : <ResultLine k={a.keyResult} />)}
      <Meta a={a} />
    </article>
  );
}

export function CompactStory({ a, reasons }: { a: Card; reasons?: string[] }) {
  return (
    <article className="grid gap-1.5" aria-labelledby={`h-${a.id}`}>
      <TopicKicker topics={a.topics} />
      <Link to={`/artigos/${a.slug}`} className="headline-link">
        <h3 id={`h-${a.id}`} className="m-0 font-serif text-lg leading-snug font-semibold text-balance">{a.headline}</h3>
      </Link>
      {a.keyResult && <ResultLine k={a.keyResult} />}
      <StatusChips a={a} />
      {reasons && reasons.length > 0 && <p className="m-0 text-xs text-accent">{reasons.join(' · ')}</p>}
      <Meta a={a} />
    </article>
  );
}

/** Linha de lista (acervo, salvos, histórico). */
export function ListRow({ a }: { a: Card }) {
  return (
    <li className="grid gap-1.5 border-t border-line py-4 sm:grid-cols-[1fr_auto] sm:gap-6">
      <div className="grid gap-1.5">
        <TopicKicker topics={a.topics} extra={designLabels[a.studyDesign]} />
        <Link to={`/artigos/${a.slug}`} className="headline-link">
          <h3 className="m-0 font-serif text-lg leading-snug font-semibold">{a.headline}</h3>
        </Link>
        {a.inShort && <p className="m-0 text-sm text-muted">{a.inShort}</p>}
        {a.keyResult && <ResultLine k={a.keyResult} />}
        <StatusChips a={a} />
      </div>
      <div className="sm:text-right"><Meta a={a} /></div>
    </li>
  );
}
