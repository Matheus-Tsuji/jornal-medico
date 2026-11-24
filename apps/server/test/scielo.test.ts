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
    expect(r).toMatchObject({ pmid: null, doi: '10.1590/x.1', authors: ['Silva ML'], abstract: 'Objetivo: fictício.', pubDate: '2026-03-01', url: 'https://doi.org/10.1590/x.1' });
    expect(triage(r!).status).toBe('eligible');
  });

  it('aceita URL oficial do SciELO/DOI e descarta URL externa, com credenciais ou porta não padrão', async () => {
    const cases = [
      { ...base, DOI: '10.1590/A.1', URL: 'https://www.scielo.br/j/abc/a/123/', title: ['Heart failure: a randomized clinical trial'] },
      { ...base, DOI: '10.1590/A.2', author: [{ given: 'B', family: 'C' }], URL: 'https://evil.example/phish', title: ['Heart failure 2: a randomized clinical trial'] },
      { ...base, DOI: '10.1590/A.3', author: [{ given: 'D', family: 'E' }], URL: 'https://user:pass@doi.org/10.1590/A.3', title: ['Heart failure 3: a randomized clinical trial'] },
      { ...base, DOI: '10.1590/A.4?q=1#x', author: [{ given: 'F', family: 'G' }], URL: 'https://doi.org:8443/10.1590/A.4', title: ['Heart failure 4: a randomized clinical trial'] },
    ];
    const f = (async () => new Response(JSON.stringify({ message: { 'total-results': cases.length, items: cases } }))) as unknown as typeof fetch;
    const a = scieloAdapter(f);
    const { ids } = await a.search(q, '2026-11-09', '2026-11-16', 50);
    const recs = await a.fetchDetails(ids);
    expect(recs.map((r) => r.url)).toEqual([
      'https://www.scielo.br/j/abc/a/123/',
      'https://doi.org/10.1590/a.2',
      'https://doi.org/10.1590/a.3',
      'https://doi.org/10.1590/a.4%3Fq%3D1%23x',
    ]);
  });
});
