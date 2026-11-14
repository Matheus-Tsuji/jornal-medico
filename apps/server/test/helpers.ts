import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiAnalysis } from '@jm/contracts';
import { loadConfig, type Config } from '../src/config.ts';
import { openDb, type Db } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { buildApp } from '../src/api/app.ts';
import type { AiProvider, StructuredCall } from '../src/ai/provider.ts';
import type { ScientificSourceAdapter } from '../src/sources/pubmed.ts';
import { parsePubmedXml } from '../src/sources/pubmed.ts';

export const H = { 'x-requested-with': 'jornal-medico' };
export const fixtureXml = readFileSync(join(import.meta.dirname, 'fixtures/pubmed-synthetic.xml'), 'utf8');

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: 'test', ADMIN_EMAILS: 'admin@example.com', ...over } as NodeJS.ProcessEnv);
}

export async function setup(over: Record<string, string> = {}): Promise<{ db: Db; cfg: Config; app: FastifyInstance }> {
  const cfg = testConfig(over);
  const db = openDb(':memory:');
  seed(db, cfg);
  const app = await buildApp({ db, cfg });
  return { db, cfg, app };
}

/** Faz login pela caixa postal de dev e devolve o cookie de sessão. */
export async function login(app: FastifyInstance, db: Db, email: string): Promise<Record<string, string>> {
  db.run('DELETE FROM auth_challenges WHERE email = ?', email); // evita cooldown entre logins de teste
  await app.inject({ method: 'POST', url: '/api/v1/auth/request-code', headers: H, payload: { email } });
  const body = db.get<{ body: string }>('SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1', email)!.body;
  const code = body.match(/\d{6}/)![0];
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-code', headers: H, payload: { email, code } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.body}`);
  return { jm_session: res.cookies.find((c) => c.name === 'jm_session')!.value };
}

export function fakeAdapter(xml = fixtureXml, opts: { failSearch?: Error } = {}): ScientificSourceAdapter & { calls: number } {
  const recs = parsePubmedXml(xml);
  return {
    slug: 'pubmed',
    calls: 0,
    async search() {
      this.calls++;
      if (opts.failSearch) throw opts.failSearch;
      return { ids: recs.map((r) => r.pmid), total: recs.length };
    },
    async fetchDetails(ids) {
      return recs.filter((r) => ids.includes(r.pmid));
    },
  };
}

/** Provedor de IA falso: devolve respostas programadas na ordem. */
export function fakeProvider(responses: unknown[]): AiProvider & { calls: StructuredCall<unknown>[] } {
  const calls: StructuredCall<unknown>[] = [];
  return {
    calls,
    async structured<T>(c: StructuredCall<T>) {
      calls.push(c as StructuredCall<unknown>);
      const data = responses.shift();
      const p = c.schema.safeParse(data);
      return { data, parsed: p.success ? p.data : null, parseError: p.success ? null : p.error.message, usage: { inputTokens: 1000, cachedTokens: 0, outputTokens: 500 }, refusal: null };
    },
  };
}

export function validExtraction(over: Partial<AiAnalysis> = {}): AiAnalysis {
  return {
    inputScope: 'abstract_only',
    language: 'pt-BR',
    editorialHeadline: null,
    summary: null,
    inShort: null,
    context: null,
    objective: 'Comparar fármaco Z e placebo.',
    studyDesign: 'rct',
    population: { description: 'Adultos com hipertensão', sampleSize: 1200, followUp: null },
    interventionOrExposure: 'Fármaco Z',
    comparator: 'Placebo',
    methods: null,
    results: [{
      outcome: 'Desfecho primário', outcomeType: 'primary', measure: 'HR', measureKind: 'ratio', estimate: 0.8, estimateRaw: '0.80',
      unit: null, comparator: 'placebo', population: null, timepoint: null,
      confidenceInterval: { level: 95, lower: 0.66, upper: 0.97, raw: '0.66 to 0.97' },
      pValue: { raw: 'P=0.02', operator: '=', value: 0.02 }, sampleSize: 1200, adjusted: null,
      evidenceRef: { locator: 'abstract', quote: 'hazard ratio, 0.80; 95% CI, 0.66 to 0.97; P=0.02' }, missingReason: null,
    }],
    clinicalImplications: null,
    applicability: null,
    limitations: ['Análise baseada apenas no abstract.'],
    riskOfBias: { status: 'not_assessed', method: null, rationale: null },
    funding: null,
    conflictsOfInterest: null,
    claims: [{ text: 'O desfecho primário foi menos frequente com Z.', locator: 'abstract', quote: 'The primary outcome occurred less often with drug Z', support: 'direct', origin: 'authors' }],
    missingFields: [{ field: 'funding', reason: 'not_reported_in_available_material' }],
    reviewFlags: [],
    editorialPriority: { score: 0.7, rationale: 'Ensaio randomizado.' },
    ...over,
  };
}

export const validEditorial = {
  editorialHeadline: 'Ensaio sintético: fármaco Z reduziu o desfecho primário frente a placebo',
  summary: 'Ensaio com 1200 adultos com hipertensão. O desfecho primário foi menos frequente com Z (HR 0.80; IC 95% 0.66 a 0.97; P=0.02). Análise baseada apenas no abstract.',
  inShort: 'Menos eventos com Z, segundo o abstract; dados completos não avaliados.',
};
