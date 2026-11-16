// Adaptador Europe PMC (REST oficial). Traz o que NÃO está no PubMed: artigos só do PubMed Central e livros do NCBI.
// Os registros do PubMed (SRC:MED) e preprints (SRC:PPR) ficam de fora: os primeiros já vêm pelo adaptador PubMed e os
// preprints não passam na triagem. Docs: https://europepmc.org/RestfulWebService
import { safeFetch, type FetchLike } from '../lib/net.ts';
import { normalizeDoi, sleep } from '../lib/util.ts';
import type { NormalizedRecord, ScientificSourceAdapter } from './pubmed.ts';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

/**
 * Converte a consulta de tema (sintaxe PubMed) para a do Europe PMC. Registros fora do PubMed quase não têm MeSH nem
 * tipo de publicação, então o tema vira busca no título e o desenho do estudo é exigido no título.
 * ponytail: só cobre a forma das consultas do seed ("X"[MeSH Terms] OR termo[tiab|ti]) AND (tipos[pt]) AND (idiomas[la]).
 */
/** Termos do tema (MeSH e texto livre) de uma consulta PubMed do seed, sem as aspas. */
export function topicTerms(pubmed: string): string[] {
  const groups = pubmed.split(/\)\s+AND\s+\(/).map((g) => g.replace(/^\(|\)$/g, ''));
  const topic = groups.find((g) => !/\[(pt|la)\]/.test(g)) ?? groups[0] ?? '';
  return topic.split(/\s+OR\s+/).map((t) => /^"?(.+?)"?\[(MeSH Terms|tiab|ti)\]$/.exec(t.trim())?.[1]).filter((t): t is string => !!t);
}

export function toEuropePmcQuery(pubmed: string): string {
  // Só título: MESH: no Europe PMC casa termos minerados do texto e trouxe estudos fora do tema.
  const terms = topicTerms(pubmed).map((t) => `TITLE:${t.includes(' ') ? `"${t}"` : t}`);
  const design = '(TITLE:"meta-analysis" OR TITLE:"meta analysis" OR TITLE:"systematic review" OR TITLE:randomized OR TITLE:randomised OR TITLE:guideline OR TITLE:cohort)';
  return `(${terms.join(' OR ')}) AND ${design} AND (LANG:eng OR LANG:por OR LANG:spa) AND NOT SRC:MED AND NOT SRC:PPR`;
}

/** Tipos no vocabulário do PubMed (os que a triagem entende), inferidos do título (inglês, português ou espanhol). */
export function typesFromTitle(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (/meta-?\s?analys|metan[aá]lis/.test(t)) out.push('Meta-Analysis');
  if (/systematic (literature )?review|revis[aãi][oó]n? sistem[aá]tica/.test(t)) out.push('Systematic Review');
  if (/randomi[sz]ed|randomizad|aleatori[sz]ad/.test(t)) out.push('Randomized Controlled Trial');
  if (/guideline|diretriz|gu[ií]a de pr[aá]ctica/.test(t)) out.push('Practice Guideline');
  if (/cohort|observational|coorte|observacional/.test(t)) out.push('Observational Study');
  return out;
}

const stripTags = (s: string) => s.replace(/<title>[^<]*<\/title>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const LANG: Record<string, string> = { eng: 'eng', por: 'por', spa: 'spa', en: 'eng', pt: 'por', es: 'spa' };

type Hit = {
  id: string; source: string; pmid?: string; pmcid?: string; doi?: string; title: string; abstractText?: string; language?: string;
  firstPublicationDate?: string; firstIndexDate?: string; pubTypeList?: { pubType: string[] };
  journalInfo?: { journal?: { title?: string; issn?: string; essn?: string } };
  authorList?: { author: { fullName?: string; collectiveName?: string }[] };
  meshHeadingList?: { meshHeading: { descriptorName: string }[] };
};

export function europePmcAdapter(f: FetchLike = fetch): ScientificSourceAdapter {
  const found = new Map<string, Hit>();
  // Europe PMC pede uso moderado; uma chamada por vez com folga basta para o volume diário.
  let gate: Promise<void> = Promise.resolve();
  const get = async (url: string) => {
    const turn = gate.then(async () => { await sleep(200); });
    gate = turn.catch(() => {});
    await turn;
    const res = await safeFetch(url, {}, f);
    if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);
    return res;
  };

  const abstractOf = async (h: Hit) => {
    if (h.abstractText) return stripTags(h.abstractText);
    if (!h.pmcid) return null;
    const body = await (await get(`${BASE}/${h.pmcid}/fullTextXML`).catch(() => null))?.text();
    const m = body && /<abstract(?:\s[^>]*)?>([\s\S]*?)<\/abstract>/.exec(body);
    return m ? stripTags(m[1]!) || null : null;
  };

  return {
    slug: 'europepmc',
    async search(query, from, to, max) {
      const q = `${toEuropePmcQuery(query)} AND FIRST_IDATE:[${from} TO ${to}]`;
      const ids: string[] = [];
      let cursor = '*';
      let total = 0;
      while (ids.length < max) {
        const qs = new URLSearchParams({ query: q, format: 'json', resultType: 'core', pageSize: String(Math.min(100, max - ids.length)), cursorMark: cursor });
        const j = await (await get(`${BASE}/search?${qs}`)).json() as { hitCount: number; nextCursorMark?: string; resultList: { result: Hit[] } };
        total = j.hitCount;
        for (const h of j.resultList.result) { found.set(h.id, h); ids.push(h.id); }
        if (!j.resultList.result.length || !j.nextCursorMark || j.nextCursorMark === cursor) break;
        cursor = j.nextCursorMark;
      }
      return { ids, total };
    },
    async fetchDetails(ids) {
      const out: NormalizedRecord[] = [];
      for (const id of ids) {
        const h = found.get(id);
        if (!h) continue; // recheck de retratação é feito pelo PubMed
        const types = [...new Set([...typesFromTitle(h.title), ...(h.pubTypeList?.pubType ?? []).filter((t) => /^[A-Z]/.test(t))])];
        const j = h.journalInfo?.journal;
        out.push({
          externalId: `${h.source}:${h.id}`,
          pmid: h.pmid ?? null,
          pmcid: h.pmcid ?? null,
          doi: h.doi ? normalizeDoi(h.doi) : null,
          title: h.title.replace(/\.$/, ''),
          abstract: await abstractOf(h),
          authors: (h.authorList?.author ?? []).map((a) => a.fullName ?? a.collectiveName ?? '').filter(Boolean),
          journal: j?.title ? { title: j.title, issn: j.issn ?? null, eissn: j.essn ?? null } : null,
          publicationTypes: types,
          pubDate: h.firstPublicationDate ?? null,
          indexedAt: h.firstIndexDate ?? null,
          language: h.language ? LANG[h.language] ?? h.language : null,
          mesh: (h.meshHeadingList?.meshHeading ?? []).map((m) => m.descriptorName),
          retracted: types.some((t) => /retract/i.test(t)),
          corrected: false,
          url: h.pmcid ? `https://europepmc.org/article/PMC/${h.pmcid}` : `https://europepmc.org/article/${h.source}/${h.id}`,
        });
      }
      return out;
    },
  };
}
