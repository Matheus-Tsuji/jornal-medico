// Só metadados e ementas da fonte; nenhum resumo jurídico ou análise científica é publicado aqui.
import { z } from 'zod';
import type { MonitoredDocument, MonitorDto, MonitorSource } from '@jm/contracts';
import type { Db } from '../db/index.ts';
import { json } from '../db/index.ts';
import { safeFetch, type FetchLike } from '../lib/net.ts';
import { nowIso, sha256 } from '../lib/util.ts';

const journals = [
  { id: 'nejm', name: 'New England Journal of Medicine', issn: '0028-4793' },
  { id: 'jama', name: 'JAMA', issn: '0098-7484' },
  { id: 'lancet', name: 'The Lancet', issn: '0140-6736' },
  { id: 'bmj', name: 'The BMJ', issn: '1756-1833' },
];
type Source = Omit<MonitorSource, 'lastSuccessAt' | 'error'>;
const monitorSources: Source[] = [
  { id: 'camara', name: 'Câmara dos Deputados', kind: 'regulation', url: 'https://dadosabertos.camara.leg.br/', mode: 'automatic', scope: '100 proposições mais recentes classificadas no tema Saúde (56). Situação atual deve ser conferida na ficha oficial.' },
  { id: 'ms', name: 'Ministério da Saúde / Saúde Legis', kind: 'regulation', url: 'https://www.gov.br/saude/pt-br/acesso-a-informacao/institucional/legislacao/legislacao', mode: 'reference', scope: 'Atos normativos federais do SUS. Consulta oficial e cadastro editorial; coleta automática ainda não disponível.' },
  { id: 'digital', name: 'Ministério da Saúde — Saúde Digital', kind: 'regulation', url: 'https://www.gov.br/saude/pt-br/composicao/seidigi/legislacao', mode: 'reference', scope: 'Legislação sobre informação e saúde digital. Consulta oficial e cadastro editorial.' },
  { id: 'conitec', name: 'Conitec', kind: 'regulation', url: 'https://www.gov.br/conitec/pt-br/assuntos/avaliacao-de-tecnologias-em-saude/recomendacoes-da-conitec', mode: 'reference', scope: 'Avaliação e incorporação de tecnologias no SUS. Consulta oficial e cadastro editorial.' },
  { id: 'dou', name: 'Diário Oficial da União', kind: 'regulation', url: 'https://www.in.gov.br/', mode: 'reference', scope: 'Portarias, resoluções e demais atos publicados. Consulta oficial e cadastro editorial.' },
  { id: 'planalto', name: 'Planalto — legislação federal', kind: 'regulation', url: 'https://www.planalto.gov.br/', mode: 'reference', scope: 'Leis e decretos federais. Consulta oficial e cadastro editorial.' },
  { id: 'senado', name: 'Senado Federal', kind: 'regulation', url: 'https://www25.senado.leg.br/web/atividade/materias', mode: 'reference', scope: 'Propostas e tramitação no Senado. Consulta oficial e cadastro editorial.' },
  { id: 'anvisa', name: 'Anvisa', kind: 'regulation', url: 'https://www.gov.br/anvisa/pt-br/assuntos/regulamentacao/legislacao', mode: 'reference', scope: 'Regulação sanitária e tecnologias em saúde. Consulta oficial e cadastro editorial.' },
  ...journals.map((j): Source => ({ id: j.id, name: j.name, kind: 'publication', url: `https://api.crossref.org/journals/${j.issn}/works`, mode: 'automatic', scope: '30 registros recentes via Crossref. Metadados bibliográficos, sem texto integral nem análise; podem incluir editoriais e cartas.' })),
];
export const automaticSources = monitorSources.filter((s) => s.mode === 'automatic').map((s) => s.id);

const technology = (s: string) => /tecnolog|digital|telessa[uú]de|telemedicina|intelig[eê]ncia artificial|dispositivo|software|dados pessoais/i.test(s);
const plain = (s: string) => s.replace(/<[^>]*>/g, '').trim();
const camaraSchema = z.object({ dados: z.array(z.object({
  id: z.number().int().positive(), siglaTipo: z.string(), numero: z.number(), ano: z.number(), ementa: z.string(), dataApresentacao: z.string().optional(),
})) });
const crossrefSchema = z.object({ message: z.object({ items: z.array(z.object({
  DOI: z.string().regex(/^10\.\d{4,9}\/\S+$/i), title: z.array(z.string()),
  published: z.object({ 'date-parts': z.array(z.array(z.number().int())) }).optional(),
})) }) });

export async function fetchMonitor(source: string, f: FetchLike = fetch): Promise<MonitoredDocument[]> {
  if (source === 'camara') {
    const u = 'https://dadosabertos.camara.leg.br/api/v2/proposicoes?codTema=56&itens=100&ordem=DESC&ordenarPor=id';
    const res = await safeFetch(u, { headers: { Accept: 'application/json' } }, f);
    if (!res.ok) throw new Error(`Câmara: HTTP ${res.status}`);
    const data = camaraSchema.parse(await res.json());
    return data.dados.map((r) => ({
      id: `camara:${r.id}`, source, kind: 'regulation', title: `${r.siglaTipo} ${r.numero}/${r.ano}`,
      identifier: `${r.siglaTipo} ${r.numero}/${r.ano}`, description: r.ementa,
      date: r.dataApresentacao?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null, dateLabel: 'Apresentação',
      url: `https://www.camara.leg.br/propostas-legislativas/${r.id}`,
      stage: 'Proposição legislativa · não equivale a lei em vigor', technology: technology(r.ementa),
    }));
  }
  const j = journals.find((j) => j.id === source);
  if (!j) throw new Error('Fonte automática não implementada');
  const res = await safeFetch(`https://api.crossref.org/journals/${j.issn}/works?rows=30&sort=published&order=desc&filter=type:journal-article`, {}, f);
  if (!res.ok) throw new Error(`Crossref: HTTP ${res.status}`);
  const data = crossrefSchema.parse(await res.json());
  return data.message.items.filter((r) => r.title[0]?.trim()).map((r) => {
    const parts = r.published?.['date-parts'][0];
    // Datas parciais continuam parciais; não inventa mês ou dia.
    const date = parts?.length && parts.length <= 3 ? parts.map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-') : null;
    return { id: `doi:${r.DOI.toLowerCase()}`, source, kind: 'publication', title: plain(r.title[0]!), identifier: r.DOI,
      description: null, date, dateLabel: 'Publicação informada', url: `https://doi.org/${encodeURIComponent(r.DOI)}`,
      stage: 'Metadados Crossref · sem análise editorial', technology: false };
  });
}

function storeDocuments(db: Db, items: MonitoredDocument[]) {
  db.tx(() => {
    for (const item of items) db.run(
      'INSERT INTO monitored_documents(id,source,kind,payload,retrieved_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,retrieved_at=excluded.retrieved_at',
      item.id, item.source, item.kind, JSON.stringify(item), nowIso(),
    );
  });
}
export async function syncMonitor(db: Db, source: string, f: FetchLike = fetch) {
  try {
    const items = await fetchMonitor(source, f);
    storeDocuments(db, items);
    db.run('INSERT INTO monitor_sync(source,last_success_at,last_error) VALUES(?,?,NULL) ON CONFLICT(source) DO UPDATE SET last_success_at=excluded.last_success_at,last_error=NULL', source, nowIso());
    return { source, collected: items.length };
  } catch (e) {
    db.run('INSERT INTO monitor_sync(source,last_error) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET last_error=excluded.last_error', source, 'A coleta falhou; consulte a fonte oficial.');
    throw e;
  }
}
export function listMonitor(db: Db, kind: MonitoredDocument['kind']): MonitorDto {
  return {
    items: db.all<{ payload: string }>('SELECT payload FROM monitored_documents WHERE kind=? ORDER BY retrieved_at DESC, id LIMIT 1000', kind)
      .map((r) => json<MonitoredDocument | null>(r.payload, null)).filter((r): r is MonitoredDocument => r !== null)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id)),
    sources: monitorSources.filter((s) => s.kind === kind).map((s) => {
      const row = db.get<{ last_success_at: string | null; last_error: string | null }>('SELECT * FROM monitor_sync WHERE source=?', s.id);
      return { ...s, lastSuccessAt: row?.last_success_at ?? null, error: row?.last_error ?? null };
    }),
  };
}

export const officialInput = z.strictObject({
  source: z.enum(['ms', 'digital', 'conitec', 'dou', 'planalto', 'senado', 'anvisa']),
  title: z.string().trim().min(5).max(500), identifier: z.string().trim().min(2).max(150),
  description: z.string().trim().min(10).max(6000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s).nullable(),
  url: z.string().url().max(2000), confirmedVerbatim: z.literal(true),
}).superRefine((r, ctx) => {
  const u = new URL(r.url);
  const hosts: Record<string, string[]> = { ms: ['www.gov.br', 'bvsms.saude.gov.br', 'saudelegis.saude.gov.br'], digital: ['www.gov.br'], conitec: ['www.gov.br'], dou: ['www.in.gov.br', 'in.gov.br'], planalto: ['www.planalto.gov.br', 'planalto.gov.br'], senado: ['www25.senado.leg.br', 'www12.senado.leg.br', 'legis.senado.leg.br'], anvisa: ['www.gov.br', 'anvisalegis.datalegis.net'] };
  const root = r.source === 'conitec' ? '/conitec/' : r.source === 'anvisa' ? '/anvisa/' : '/saude/';
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !hosts[r.source]!.includes(u.hostname) || (u.hostname === 'www.gov.br' && !u.pathname.startsWith(root))) {
    ctx.addIssue({ code: 'custom', message: 'Use um link HTTPS do órgão oficial selecionado.', path: ['url'] });
  }
});
export function importOfficial(db: Db, input: z.infer<typeof officialInput>) {
  const r = { source: input.source, title: input.title, identifier: input.identifier, description: input.description, date: input.date, url: input.url };
  const item: MonitoredDocument = { ...r, id: `official:${sha256(r.url)}`, kind: 'regulation', dateLabel: 'Data do documento',
    stage: 'Documento oficial · vigência e efeitos não verificados', technology: technology(`${r.title} ${r.description}`) };
  storeDocuments(db, [item]);
  return item;
}
