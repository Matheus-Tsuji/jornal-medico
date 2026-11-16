// Adaptador SciELO via Crossref (API pública oficial; todo DOI SciELO tem o prefixo 10.1590). O buscador do SciELO
// bloqueia acesso automatizado, então não é usado. Data de referência: criação do DOI (from-created-date), para não
// trazer artigos antigos reindexados. Docs: https://api.crossref.org/swagger-ui/index.html
import { safeFetch, type FetchLike } from '../lib/net.ts';
import { normalizeDoi, sleep } from '../lib/util.ts';
import { topicTerms, typesFromTitle } from './europepmc.ts';
import type { NormalizedRecord, ScientificSourceAdapter } from './pubmed.ts';

const BASE = 'https://api.crossref.org/works';

type Item = {
  DOI: string; title?: string[]; abstract?: string; 'container-title'?: string[]; ISSN?: string[]; URL?: string; language?: string;
  author?: { given?: string; family?: string; name?: string }[];
  published?: { 'date-parts': number[][] }; created?: { 'date-time': string };
};

const stripTags = (s: string) => s.replace(/<jats:title>[^<]*<\/jats:title>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** "Maria L. Silva" → "Silva ML" (formato PubMed, usado na referência ABNT). */
const author = (a: NonNullable<Item['author']>[number]) =>
  a.family ? `${a.family} ${(a.given ?? '').split(/[\s.-]+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).join('')}`.trim() : a.name ?? '';
const date = (p?: { 'date-parts': number[][] }) => {
  const [y, m = 1, d = 1] = p?.['date-parts']?.[0] ?? [];
  return y ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};
const LANG: Record<string, string> = { en: 'eng', pt: 'por', es: 'spa' };

export function scieloAdapter(f: FetchLike = fetch): ScientificSourceAdapter {
  const found = new Map<string, Item>();
  let gate: Promise<void> = Promise.resolve();
  const get = async (url: string) => {
    const turn = gate.then(async () => { await sleep(300); });
    gate = turn.catch(() => {});
    await turn;
    const res = await safeFetch(url, { timeoutMs: 30_000 }, f);
    if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
    return res.json() as Promise<{ message: { 'total-results': number; items: Item[]; 'next-cursor'?: string } }>;
  };

  return {
    slug: 'scielo',
    async search(query, from, to, max, topicLabel) {
      // Termos do tema em inglês (consulta PubMed) e o nome do tema em português.
      const terms = [...topicTerms(query), ...(topicLabel ? [topicLabel] : [])].map((t) => t.replace(/\*$/, '').toLowerCase());
      // A busca do Crossref é por relevância (frouxa); o tema e o desenho do estudo são conferidos no título aqui.
      const onTopic = (title: string) => terms.some((t) => title.toLowerCase().includes(t)) && typesFromTitle(title).length > 0;
      const ids: string[] = [];
      const versions = new Set<string>();
      let cursor = '*';
      let seen = 0;
      while (ids.length < max && seen < 1000) {
        const qs = new URLSearchParams({
          filter: `prefix:10.1590,type:journal-article,from-created-date:${from},until-created-date:${to}`,
          'query.bibliographic': terms.join(' '), rows: '100', cursor,
        });
        const { message: m } = await get(`${BASE}?${qs}`);
        for (const it of m.items) {
          const title = decode(it.title?.[0] ?? '');
          // O SciELO registra um DOI por idioma do mesmo artigo: mesmos autores, revista e data = mesma publicação.
          const key = `${(it.author ?? []).map(author).join('|')}#${it['container-title']?.[0]}#${date(it.published)}`;
          if (title && onTopic(title) && !found.has(it.DOI) && !versions.has(key)) { versions.add(key); found.set(it.DOI, it); ids.push(it.DOI); }
        }
        seen += m.items.length;
        if (m.items.length < 100 || !m['next-cursor']) break;
        cursor = m['next-cursor'];
      }
      return { ids: ids.slice(0, max), total: ids.length };
    },
    async fetchDetails(ids) {
      return ids.flatMap((doi): NormalizedRecord[] => {
        const it = found.get(doi);
        if (!it) return [];
        const title = decode(it.title?.[0] ?? '').replace(/\.$/, '');
        return [{
          externalId: it.DOI,
          pmid: null,
          pmcid: null,
          doi: normalizeDoi(it.DOI),
          title,
          abstract: it.abstract ? decode(stripTags(it.abstract)) || null : null,
          authors: (it.author ?? []).map(author).filter(Boolean),
          journal: it['container-title']?.[0] ? { title: decode(it['container-title'][0]), issn: it.ISSN?.[0] ?? null, eissn: it.ISSN?.[1] ?? null } : null,
          publicationTypes: typesFromTitle(title),
          pubDate: date(it.published),
          indexedAt: it.created?.['date-time']?.slice(0, 10) ?? null,
          language: it.language ? LANG[it.language] ?? null : null,
          mesh: [],
          retracted: false,
          corrected: false,
          url: it.URL ?? `https://doi.org/${it.DOI}`,
        }];
      });
    },
  };
}
