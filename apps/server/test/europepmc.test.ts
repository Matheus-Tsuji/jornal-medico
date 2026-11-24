import { describe, expect, it } from 'vitest';
import { europePmcAdapter, toEuropePmcQuery, typesFromTitle } from '../src/sources/europepmc.ts';
import { triage } from '../src/worker/ingestion.ts';

const seedQuery = '("Hypertension"[MeSH Terms] OR hypertension[tiab]) AND (Randomized Controlled Trial[pt] OR Meta-Analysis[pt]) AND (english[la] OR portuguese[la])';

describe('Europe PMC', () => {
  it('traduz a consulta do tema e exclui o que já vem do PubMed', () => {
    const q = toEuropePmcQuery(seedQuery);
    expect(q).toContain('(TITLE:Hypertension OR TITLE:hypertension)');
    expect(q).not.toContain('MESH:');
    expect(q).toContain('NOT SRC:MED');
    expect(q).toContain('NOT SRC:PPR');
    expect(q).not.toContain('[pt]');
    expect(q).not.toContain('[la]');
  });

  it('infere o desenho pelo título', () => {
    expect(typesFromTitle('X in Y: A Systematic Review and Meta-Analysis')).toEqual(['Meta-Analysis', 'Systematic Review']);
    expect(typesFromTitle('A randomised trial of Z')).toEqual(['Randomized Controlled Trial']);
    expect(typesFromTitle('Case report of W')).toEqual([]);
  });

  it('normaliza registro do PMC e busca o abstract no texto integral', async () => {
    const hit = {
      id: 'PMC1', source: 'PMC', pmcid: 'PMC1', doi: '10.99999/ABC', title: 'Drug A for hypertension: a meta-analysis.', language: 'eng',
      firstPublicationDate: '2026-11-10', firstIndexDate: '2026-11-11', pubTypeList: { pubType: ['research-article', 'Journal Article'] },
      journalInfo: { journal: { title: 'Revista Fictícia', issn: '0000-0000' } }, authorList: { author: [{ fullName: 'Silva A' }] },
    };
    const calls: string[] = [];
    const f = (async (u: URL) => {
      calls.push(String(u));
      if (String(u).includes('/search?')) return new Response(JSON.stringify({ hitCount: 1, nextCursorMark: 'x', resultList: { result: [hit] } }));
      return new Response('<article><front><abstract><title>Abstract</title><p>Background <italic>fictício</italic>.</p></abstract></front></article>');
    }) as unknown as typeof fetch;
    const a = europePmcAdapter(f);
    const { ids, total } = await a.search(seedQuery, '2026-11-09', '2026-11-16', 50);
    expect(total).toBe(1);
    expect(calls[0]).toContain('FIRST_IDATE');
    const [r] = await a.fetchDetails(ids);
    expect(r).toMatchObject({ pmid: null, pmcid: 'PMC1', doi: '10.99999/abc', title: 'Drug A for hypertension: a meta-analysis', abstract: 'Background fictício .', authors: ['Silva A'], url: 'https://europepmc.org/article/PMC/PMC1' });
    expect(r!.publicationTypes).toContain('Meta-Analysis');
    expect(triage(r!).status).toBe('eligible');
  });

  it('rejeita pmcid fora do formato no fullTextXML e codifica segmentos na url', async () => {
    const hit = {
      id: 'id/com?query', source: 'PPR/1', pmcid: '../search?x=1', title: 'Drug B for hypertension: a meta-analysis.', language: 'eng',
      pubTypeList: { pubType: ['Journal Article'] },
    };
    const calls: string[] = [];
    const f = (async (u: URL) => {
      calls.push(String(u));
      return new Response(JSON.stringify({ hitCount: 1, resultList: { result: [hit] } }));
    }) as unknown as typeof fetch;
    const a = europePmcAdapter(f);
    const { ids } = await a.search(seedQuery, '2026-11-09', '2026-11-16', 50);
    const [r] = await a.fetchDetails(ids);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/search?');
    expect(calls.some((u) => u.includes('fullTextXML'))).toBe(false);
    expect(r!.abstract).toBeNull();
    expect(r!.url).toBe('https://europepmc.org/article/PPR%2F1/id%2Fcom%3Fquery');
  });
});
