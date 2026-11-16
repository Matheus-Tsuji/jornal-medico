import { describe, expect, it } from 'vitest';
import { scieloAdapter } from '../src/sources/scielo.ts';
import { triage } from '../src/worker/ingestion.ts';

const q = '("Heart Failure"[MeSH Terms] OR "heart failure"[tiab]) AND (Randomized Controlled Trial[pt]) AND (english[la])';
const base = {
  'container-title': ['Revista Fictícia'], ISSN: ['0000-0000'], published: { 'date-parts': [[2026, 3]] }, created: { 'date-time': '2026-11-10T00:00:00Z' },
  author: [{ given: 'Maria Luiza', family: 'Silva' }], abstract: '<jats:p>Objetivo: fictício.</jats:p>',
};
const items = [
  { ...base, DOI: '10.1590/X.1', title: ['Transition plan in heart failure: a randomized clinical trial'] },
  { ...base, DOI: '10.1590/X.2', title: ['Plano de transição na insuficiência cardíaca: ensaio clínico randomizado'] }, // mesma publicação, outro idioma
  { ...base, DOI: '10.1590/Y.1', author: [{ given: 'Ana', family: 'Costa' }], title: ['Mortalidade por insuficiência cardíaca: revisão sistemática'] },
  { ...base, DOI: '10.1590/Z.1', author: [{ given: 'Rui', family: 'Melo' }], title: ['Relato de caso de insuficiência cardíaca'] }, // sem desenho no título
  { ...base, DOI: '10.1590/W.1', author: [{ given: 'Ivo', family: 'Lima' }], title: ['Asthma in children: a meta-analysis'] }, // fora do tema
];

describe('SciELO (via Crossref)', () => {
  it('filtra por tema (inglês ou nome em português) e desenho, e une versões em outro idioma', async () => {
    let url = '';
    const f = (async (u: URL) => { url = String(u); return new Response(JSON.stringify({ message: { 'total-results': items.length, items } })); }) as unknown as typeof fetch;
    const a = scieloAdapter(f);
    const { ids } = await a.search(q, '2026-11-09', '2026-11-16', 50, 'Insuficiência cardíaca');
    expect(url).toContain('prefix%3A10.1590');
    expect(url).toContain('from-created-date%3A2026-11-09');
    expect(ids).toEqual(['10.1590/X.1', '10.1590/Y.1']);
    const [r] = await a.fetchDetails(ids);
    expect(r).toMatchObject({ pmid: null, doi: '10.1590/x.1', authors: ['Silva ML'], abstract: 'Objetivo: fictício.', pubDate: '2026-03-01' });
    expect(triage(r!).status).toBe('eligible');
  });
});
