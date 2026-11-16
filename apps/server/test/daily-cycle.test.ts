// Simulação de dias seguidos do ciclo diário: o backend busca, analisa e entrega sozinho, dia após dia.
import { describe, expect, it } from 'vitest';
import type { AiProvider, StructuredCall } from '../src/ai/provider.ts';
import { openDb } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { previewEdition } from '../src/modules/content.ts';
import { analyzePriority, claim, enqueue, expireStaleAnalyses } from '../src/modules/jobs.ts';
import { parsePubmedXml, type ScientificSourceAdapter } from '../src/sources/pubmed.ts';
import { runCycle } from '../src/worker/runner.ts';
import { fixtureXml, testConfig, validEditorial, validExtraction } from './helpers.ts';

// Artigo sintético 1 do fixture (RCT válido), clonado com PMID/DOI/título novos para cada "dia".
const article1 = fixtureXml.slice(fixtureXml.indexOf('<PubmedArticle>'), fixtureXml.indexOf('</PubmedArticle>') + '</PubmedArticle>'.length);
function articleXml(n: number, opts: { oldPubYear?: boolean } = {}) {
  const pmid = String(99999900 + n);
  let x = article1.replaceAll('99999901', pmid).replaceAll('syn.0001', `syn.${n}`).replaceAll('SYN.0001', `SYN.${n}`)
    .replace('Synthetic trial of drug', `Synthetic trial ${n} of drug`);
  if (opts.oldPubYear) x = x.replace('<ArticleDate DateType="Electronic"><Year>2026</Year><Month>11</Month><Day>10</Day>', '<ArticleDate DateType="Electronic"><Year>2026</Year><Month>05</Month><Day>02</Day>');
  return x;
}
const setXml = (items: string[]) => `<?xml version="1.0" ?><PubmedArticleSet>${items.join('')}</PubmedArticleSet>`;

/** PubMed falso cujo conteúdo muda conforme o "dia" da simulação. */
function dailyAdapter(): ScientificSourceAdapter & { day: string } {
  return {
    slug: 'pubmed',
    day: '',
    async search() {
      const recs = parsePubmedXml(this.day);
      return { ids: recs.map((r) => r.pmid!), total: recs.length };
    },
    async fetchDetails(ids) {
      return parsePubmedXml(this.day).filter((r) => ids.includes(r.pmid!));
    },
  };
}

/** IA falsa: extração e redação válidas. O artigo 5 vira coorte (nota B, pior que os ensaios A de ontem),
 *  para provar que a capa abre com o que é novo e não só com a melhor nota. */
const okProvider: AiProvider = {
  async structured<T>(c: StructuredCall<T>) {
    const data = c.name === 'article_analysis' ? validExtraction(c.user.includes('Synthetic trial 5 ') ? { studyDesign: 'cohort' } : {}) : validEditorial;
    const p = c.schema.safeParse(data);
    return { data, parsed: p.success ? p.data : null, parseError: p.success ? null : p.error.message, usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 500 }, refusal: null };
  },
};
const offline = async () => new Response('offline', { status: 503 }); // monitor de documentos oficiais sem rede no teste

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('fila do ciclo diário', () => {
  it('coleta primeiro; entre análises, metanálise > ensaio > resto; análise velha demais expira com motivo', () => {
    const db = openDb(':memory:');
    enqueue(db, 'analyze', 'a-outro', { articleId: 'x1' }, { priority: analyzePriority(['Observational Study']) });
    enqueue(db, 'analyze', 'a-meta', { articleId: 'x2' }, { priority: analyzePriority(['Meta-Analysis', 'Journal Article']) });
    enqueue(db, 'analyze', 'a-rct', { articleId: 'x3' }, { priority: analyzePriority(['Randomized Controlled Trial']) });
    enqueue(db, 'discover', 'd-hoje', { topic: 'diabetes' });
    const ordem = [1, 2, 3, 4].map(() => claim(db, 't')!.idempotency_key);
    expect(ordem).toEqual(['d-hoje', 'a-meta', 'a-rct', 'a-outro']);

    enqueue(db, 'analyze', 'a-velha', { articleId: 'x4' });
    db.run("UPDATE jobs SET created_at = ? WHERE idempotency_key = 'a-velha'", hoursAgo(15 * 24));
    enqueue(db, 'analyze', 'a-nova', { articleId: 'x5' });
    expect(expireStaleAnalyses(db, 14)).toBe(1);
    const velha = db.get<{ status: string; last_error: string }>("SELECT status, last_error FROM jobs WHERE idempotency_key = 'a-velha'")!;
    expect(velha.status).toBe('blocked');
    expect(velha.last_error).toMatch(/Expirado: 14 dias/);
    expect(db.get<{ status: string }>("SELECT status FROM jobs WHERE idempotency_key = 'a-nova'")!.status).toBe('queued');
  });
});

describe('ciclo diário autônomo (retroalimentação)', () => {
  it('dia após dia: busca o que saiu, analisa, adia o que passa do limite e entrega os novos primeiro na capa', async () => {
    const cfg = testConfig({ OPENAI_API_KEY: 'sk-teste-falso', OPENAI_ANALYSIS_MODEL: 'gpt-6.1-terra', OPENAI_EDITORIAL_MODEL: 'gpt-6-luna', AI_MAX_ARTICLES_PER_DAY: '3' });
    const db = openDb(':memory:');
    seed(db, cfg);
    db.run("UPDATE feature_flags SET enabled = 1 WHERE key IN ('real_content', 'ai_preview')");
    const adapter = dailyAdapter();
    const deps = { adapter, provider: okProvider, monitorFetch: offline };
    const realArticles = () => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 0')!.n;
    const inReview = () => db.all<{ pmid: string }>("SELECT ar.pmid FROM analyses a JOIN articles ar ON ar.id = a.article_id WHERE a.is_demo = 0 AND a.status = 'in_review'").map((r) => r.pmid).sort();

    // ---- Dia 1: saem 4 estudos; o limite diário de IA é 3.
    adapter.day = setXml([1, 2, 3, 4].map((n) => articleXml(n)));
    // 4 tarefas em paralelo para 4 artigos: sem a reserva das análises em andamento, as 4 passariam pelo limite juntas.
    const d1 = await runCycle(db, cfg, deps, { workerId: 'dia1', budgetMs: 30_000, concurrency: 4, now: new Date() });
    expect(realArticles()).toBe(4);
    expect(inReview()).toHaveLength(3); // limite respeitado mesmo com análises em paralelo
    const deferred = db.all<{ status: string; last_error: string }>("SELECT status, last_error FROM jobs WHERE type = 'analyze' AND status <> 'completed'");
    expect(deferred).toEqual([{ status: 'retry', last_error: expect.stringMatching(/Limite diário/) }]);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('blocked','failed')")!.n).toBe(0);
    expect(d1.byType.discover).toBeGreaterThan(0);
    const capa1 = previewEdition(db, null, '2026-11-16')!;
    expect(capa1.freshCount).toBe(3);

    // Rodar de novo no mesmo dia não duplica buscas nem análises (idempotência).
    const jobsAntes = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs')!.n;
    await runCycle(db, cfg, deps, { workerId: 'dia1-bis', budgetMs: 30_000, concurrency: 3, now: new Date() });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jobs')!.n).toBe(jobsAntes);
    expect(inReview()).toHaveLength(3);

    // ---- Passa um dia: a cota de IA renova, o adiado volta, as análises de ontem deixam de ser "novas".
    db.run("UPDATE ai_usage SET created_at = ?", hoursAgo(25));
    db.run("UPDATE analyses SET created_at = ? WHERE is_demo = 0", hoursAgo(40));
    db.run("UPDATE jobs SET next_run_at = ? WHERE status = 'retry'", hoursAgo(0.01));

    // ---- Dia 2: o PubMed devolve 2 de ontem (janela sobreposta) + 2 novos, um deles publicado há meses e indexado agora.
    adapter.day = setXml([articleXml(3), articleXml(4), articleXml(5), articleXml(6, { oldPubYear: true })]);
    const d2 = await runCycle(db, cfg, deps, { workerId: 'dia2', budgetMs: 30_000, concurrency: 3, now: new Date(Date.now() + 86_400_000) });
    expect(realArticles()).toBe(6); // nada duplicado
    expect(inReview()).toEqual(['99999901', '99999902', '99999903', '99999904', '99999905', '99999906']); // o adiado de ontem também entrou
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('blocked','failed')")!.n).toBe(0);
    expect(d2.byType.analyze).toBe(3);

    // A capa do dia 2 abre com o que chegou hoje (4, 5 e 6), mesmo o 5 tendo nota pior que os ensaios de ontem;
    // entre os novos, a melhor nota vem primeiro (o 5, coorte, fica atrás).
    const capa2 = previewEdition(db, null, '2026-11-17')!;
    expect(capa2.freshCount).toBe(3);
    const pmid = (c: { slug: string }) => c.slug.match(/pmid(\d+)$/)![1];
    const topo = [capa2.headline!, ...capa2.secondary].slice(0, 3);
    expect(topo.map(pmid).sort()).toEqual(['99999904', '99999905', '99999906']);
    expect(pmid(topo[2]!)).toBe('99999905');
    expect(topo[2]!.evidence.grade[0]).toBe('B');
  });
});
