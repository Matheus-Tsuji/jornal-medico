// Adaptador PubMed via NCBI E-utilities oficiais (ESearch + EFetch).
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/ — limite de 3 req/s sem chave, 10 req/s com NCBI_API_KEY.
import { XMLParser } from 'fast-xml-parser';
import type { Config } from '../config.ts';
import { z } from 'zod';
import { safeFetch, type FetchLike } from '../lib/net.ts';
import { normalizeDoi } from '../lib/util.ts';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export interface NormalizedRecord {
  externalId: string;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  title: string;
  abstract: string | null;
  authors: string[];
  journal: { title: string; issn: string | null; eissn: string | null } | null;
  publicationTypes: string[];
  pubDate: string | null; // YYYY-MM-DD (ou YYYY-MM-01 / YYYY-01-01 quando parcial)
  indexedAt: string | null;
  language: string | null;
  mesh: string[];
  retracted: boolean;
  corrected: boolean;
  url: string;
}

/** Contrato comum de fontes científicas. */
export interface ScientificSourceAdapter {
  slug: string;
  newRun?(): ScientificSourceAdapter;
  search(query: string, from: string, to: string, max: number, topicLabel?: string): Promise<{ ids: string[]; total: number }>;
  fetchDetails(ids: string[]): Promise<NormalizedRecord[]>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  stopNodes: ['*.AbstractText', '*.ArticleTitle'],
  isArray: (name) => ['PubmedArticle', 'Author', 'AbstractText', 'PublicationType', 'ArticleId', 'MeshHeading', 'ELocationID', 'CommentsCorrections', 'PubMedPubDate', 'ISSN', 'Language'].includes(name),
});

type X = Record<string, unknown> | undefined;
const txt = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text']);
  return '';
};
const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function dateFrom(d: X): string | null {
  if (!d) return null;
  const y = txt(d.Year);
  if (!/^\d{4}$/.test(y)) {
    const m = txt(d.MedlineDate).match(/\d{4}/);
    return m ? `${m[0]}-01-01` : null;
  }
  const mRaw = txt(d.Month).toLowerCase();
  const m = /^\d{1,2}$/.test(mRaw) ? mRaw.padStart(2, '0') : MONTHS[mRaw.slice(0, 3)] ?? '01';
  const day = txt(d.Day);
  return `${y}-${m}-${/^\d{1,2}$/.test(day) ? day.padStart(2, '0') : '01'}`;
}

export function parsePubmedXml(xml: string): NormalizedRecord[] {
  const doc = parser.parse(xml) as { PubmedArticleSet?: { PubmedArticle?: Record<string, X>[] } };
  const arts = doc.PubmedArticleSet?.PubmedArticle ?? [];
  return arts.flatMap((pa) => {
    const mc = pa.MedlineCitation as Record<string, X> | undefined;
    const art = mc?.Article as Record<string, X> | undefined;
    const pmid = txt(mc?.PMID);
    if (!pmid || !art) return [];
    const ids = ((pa.PubmedData as Record<string, X> | undefined)?.ArticleIdList as { ArticleId?: X[] } | undefined)?.ArticleId ?? [];
    const idOf = (type: string) => txt(ids.find((i) => i?.['@_IdType'] === type)) || null;
    const eloc = (art.ELocationID as X[] | undefined) ?? [];
    const doi = normalizeDoi(idOf('doi') ?? txt(eloc.find((e) => e?.['@_EIdType'] === 'doi')));
    const abstractParts = ((art.Abstract as { AbstractText?: unknown[] } | undefined)?.AbstractText ?? []).map((a) => {
      const label = typeof a === 'object' && a ? (a as Record<string, unknown>)['@_Label'] : undefined;
      const body = decode(stripTags(txt(a)));
      return label ? `${label}: ${body}` : body;
    });
    const authors = ((art.AuthorList as { Author?: X[] } | undefined)?.Author ?? []).map((a) =>
      txt(a?.CollectiveName) || [txt(a?.LastName), txt(a?.Initials)].filter(Boolean).join(' '),
    ).filter(Boolean);
    const journal = art.Journal as Record<string, X> | undefined;
    const issns = (journal?.ISSN as unknown as X[] | undefined) ?? [];
    const pubTypes = ((art.PublicationTypeList as { PublicationType?: unknown[] } | undefined)?.PublicationType ?? []).map(txt);
    const comments = ((mc?.CommentsCorrectionsList as { CommentsCorrections?: X[] } | undefined)?.CommentsCorrections ?? []).map((c) => String(c?.['@_RefType'] ?? ''));
    const history = (((pa.PubmedData as Record<string, X> | undefined)?.History as { PubMedPubDate?: X[] } | undefined)?.PubMedPubDate ?? []);
    const articleDate = (art.ArticleDate as X[] | X | undefined);
    const firstArticleDate = Array.isArray(articleDate) ? articleDate[0] : articleDate;
    const pmcid = idOf('pmc');
    const indexedAt = dateFrom(history.find((h) => h?.['@_PubStatus'] === 'pubmed'));
    // Data da edição impressa pode estar meses à frente; no futuro, vale a data em que entrou no PubMed (ou nenhuma).
    const issueDate = dateFrom((journal?.JournalIssue as Record<string, X> | undefined)?.PubDate);
    const pubDate = dateFrom(firstArticleDate) ?? (issueDate && issueDate > new Date().toISOString().slice(0, 10) ? indexedAt : issueDate);
    return [{
      externalId: pmid,
      pmid,
      pmcid,
      doi,
      title: decode(stripTags(txt(art.ArticleTitle))),
      abstract: abstractParts.length ? abstractParts.join('\n') : null,
      authors,
      journal: journal ? {
        title: txt(journal.Title),
        issn: txt(issns.find((i) => i?.['@_IssnType'] === 'Print')) || null,
        eissn: txt(issns.find((i) => i?.['@_IssnType'] === 'Electronic')) || null,
      } : null,
      publicationTypes: pubTypes,
      pubDate,
      indexedAt,
      language: txt(((art.Language as unknown[] | undefined) ?? [])[0]) || null,
      mesh: (((mc?.MeshHeadingList as { MeshHeading?: X[] } | undefined)?.MeshHeading) ?? []).map((m) => txt(m?.DescriptorName)).filter(Boolean),
      retracted: pubTypes.includes('Retracted Publication') || comments.includes('RetractionIn'),
      corrected: comments.includes('ErratumIn') || comments.includes('CorrectedandRepublishedIn'),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    }];
  });
}

const pubmedSearch = z.object({
  esearchresult: z.object({
    idlist: z.array(z.string()).optional(),
    count: z.string().regex(/^\d+$/).optional(),
    ERROR: z.string().optional(),
  }),
});
// O espaçamento entre chamadas (NCBI: 3 req/s sem chave, 10 com chave; Europe PMC; Crossref 1 req/s) fica em
// lib/rate-limits.ts (sourceFetch), compartilhado entre processos pelo banco.
export function pubmedAdapter(cfg: Config, f: FetchLike = fetch): ScientificSourceAdapter {
  const call = async (path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, tool: cfg.NCBI_TOOL });
    if (cfg.NCBI_CONTACT_EMAIL) qs.set('email', cfg.NCBI_CONTACT_EMAIL);
    if (cfg.NCBI_API_KEY) qs.set('api_key', cfg.NCBI_API_KEY);
    const res = await safeFetch(`${BASE}/${path}?${qs}`, { timeoutMs: 30_000 }, f);
    if (!res.ok) throw new Error(`PubMed ${path} HTTP ${res.status}`);
    return res;
  };
  return {
    slug: 'pubmed',
    async search(query, from, to, max) {
      const res = await call('esearch.fcgi', {
        db: 'pubmed', term: query, datetype: 'edat', mindate: from.replace(/-/g, '/'), maxdate: to.replace(/-/g, '/'),
        retmax: String(max), retmode: 'json', sort: 'pub_date',
      });
      const parsed = pubmedSearch.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new Error('PubMed esearch: contrato de resposta inválido.');
      const body = parsed.data;
      if (body.esearchresult.ERROR) throw new Error(`PubMed esearch: ${body.esearchresult.ERROR}`);
      if (body.esearchresult.count === undefined || body.esearchresult.idlist === undefined) {
        throw new Error('PubMed esearch: contrato de resposta inválido.');
      }
      return { ids: body.esearchresult.idlist, total: Number(body.esearchresult.count) };
    },
    async fetchDetails(ids) {
      const out: NormalizedRecord[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const res = await call('efetch.fcgi', { db: 'pubmed', id: ids.slice(i, i + 100).join(','), retmode: 'xml' });
        out.push(...parsePubmedXml(await res.text()));
      }
      return out;
    },
  };
}
