// Adaptador SciELO via Crossref (API pública oficial; todo DOI SciELO tem o prefixo 10.1590). O buscador do SciELO
// bloqueia acesso automatizado, então não é usado. Data de referência: criação do DOI (from-created-date), para não
// trazer artigos antigos reindexados. Docs: https://api.crossref.org/swagger-ui/index.html
import { z } from 'zod';
import { safeFetch, throttle, type FetchLike } from '../lib/net.ts';
import { httpsUrl, normalizeDoi } from '../lib/util.ts';
import { topicTerms, typesFromTitle } from './europepmc.ts';
import type { NormalizedRecord, ScientificSourceAdapter } from './pubmed.ts';

const BASE = 'https://api.crossref.org/works';

const itemSchema = z.object({
  DOI: z.string(), title: z.array(z.string()).optional(), abstract: z.string().optional(),
  'container-title': z.array(z.string()).optional(), ISSN: z.array(z.string()).optional(),
  URL: z.string().optional(), language: z.string().optional(),
  author: z.array(z.object({ given: z.string().optional(), family: z.string().optional(), name: z.string().optional() })).optional(),
  published: z.object({ 'date-parts': z.array(z.array(z.number())) }).optional(),
  created: z.object({ 'date-time': z.string() }).optional(),
});
const searchSchema = z.object({ message: z.object({ 'total-results': z.number(), items: z.array(itemSchema), 'next-cursor': z.string().optional() }) });
type Item = z.infer<typeof itemSchema>;
// Crossref: 1 req/s no pool público.
const wait = throttle(1_000);

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
const isOfficialScieloHost = (host: string) =>
  host === 'doi.org' || host === 'dx.doi.org' || host === 'scielo.br' || host === 'scielo.org' || host.endsWith('.scielo.br') || host.endsWith('.scielo.org');
function scieloUrl(raw: string | undefined, doi: string): string {
  const safe = httpsUrl(raw);
  if (safe) {
    const u = new URL(safe);
    if (!u.username && !u.password && (!u.port || u.port === '443') && isOfficialScieloHost(u.hostname)) return safe;
  }
  return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;
}

export function scieloAdapter(f: FetchLike = fetch): ScientificSourceAdapter {
  const found = new Map<string, Item>();
  const get = async (url: string) => {
    await wait();
    const res = await safeFetch(url, { timeoutMs: 30_000 }, f);
    if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
    const parsed = searchSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new Error('Crossref: contrato de resposta inválido.');
    return parsed.data;
  };

  return {
    slug: 'scielo',
    newRun: () => scieloAdapter(f),
    async search(query, from, to, max, topicLabel) {
      // Termos do tema em inglês (consulta PubMed) e o nome do tema em português.
      const terms = [...topicTerms(query), ...(topicLabel ? [topicLabel] : [])].map((t) => t.replace(/\*$/, '').toLowerCase());
      // A busca do Crossref é por relevância (frouxa); o tema e o desenho do estudo são conferidos no título aqui.
      const onTopic = (title: string) => terms.some((t) => title.toLowerCase().includes(t)) && typesFromTitle(title).length > 0;
      const ids: string[] = [];
      const versions = new Set<string>();
      const seenDois = new Set<string>();
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
          if (title && onTopic(title) && !seenDois.has(it.DOI) && !versions.has(key)) {
            versions.add(key);
            seenDois.add(it.DOI);
            found.set(it.DOI, it);
            ids.push(it.DOI);
          }
        }
        seen += m.items.length;
        if (m.items.length < 100 || !m['next-cursor']) break;
        cursor = m['next-cursor'];
      }
      return { ids: ids.slice(0, max), total: ids.length };
    },
    async fetchDetails(ids) {
      const items = ids.map((doi) => found.get(doi));
      found.clear();
      return items.flatMap((it): NormalizedRecord[] => {
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
          url: scieloUrl(it.URL, normalizeDoi(it.DOI) ?? it.DOI),
        }];
      });
    },
  };
}
