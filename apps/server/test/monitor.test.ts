import { describe, expect, it } from 'vitest';
import { fetchMonitor, importOfficial, listMonitor, officialInput, syncMonitor } from '../src/modules/monitor.ts';
import { enqueue } from '../src/modules/jobs.ts';
import { schedule } from '../src/worker/runner.ts';
import { H, login, setup } from './helpers.ts';
import type { FetchLike } from '../src/lib/net.ts';

const official = {
  source: 'digital', title: 'DEMO — portaria fictícia para teste', identifier: 'DEMO-REG-001',
  description: 'Documento fictício para testar legislação de telemedicina. Não é uma norma real.',
  date: null, url: 'https://www.gov.br/saude/pt-br/demo-reg-001', confirmedVerbatim: true,
};
describe('documentos oficiais e publicações', () => {
  it('valida origem, confirmação de transcrição e datas sem buscar URLs dos documentos', () => {
    expect(officialInput.safeParse(official).success).toBe(true);
    for (const url of ['https://evil.example/x', 'https://www.gov.br.evil.example/saude/x', 'javascript:alert(1)', 'https://www.gov.br/economia/x', 'https://user:pass@www.gov.br/saude/x']) {
      expect(officialInput.safeParse({ ...official, url }).success).toBe(false);
    }
    expect(officialInput.safeParse({ ...official, confirmedVerbatim: false }).success).toBe(false);
    expect(officialInput.safeParse({ ...official, date: '2026-02-31' }).success).toBe(false);
  });
  it('coleta proposições, mantém ementa e distingue propostas de leis', async () => {
    const urls: string[] = [];
    const f = (async (url) => {
      urls.push(String(url));
      return Response.json({ dados: [{ id: 99999901, siglaTipo: 'PL', numero: 99999901, ano: 2026, ementa: 'DEMO: proposta fictícia sobre saúde digital', dataApresentacao: '2026-11-14T12:00' }], links: [{ rel: 'next', href: 'https://evil.example' }] });
    }) as FetchLike;
    const { db } = await setup();
    await syncMonitor(db, 'camara', f);
    await syncMonitor(db, 'camara', f);
    const dto = listMonitor(db, 'regulation');
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]!.technology).toBe(true);
    expect(dto.items[0]!.stage).toContain('não equivale a lei');
    expect(dto.items[0]!.url).toBe('https://www.camara.leg.br/propostas-legislativas/99999901');
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes('codTema=56'))).toBe(true);
    await expect(syncMonitor(db, 'camara', (async () => new Response('', { status: 503 })) as FetchLike)).rejects.toThrow();
    expect(listMonitor(db, 'regulation').items).toHaveLength(1);
    expect(listMonitor(db, 'regulation').sources[0]!.error).toBeTruthy();
  });
  it('Crossref preserva data parcial e gera DOI sem buscar links da resposta', async () => {
    const f = (async () => Response.json({ message: { items: [{ DOI: '10.99999/DEMO-001', title: ['<i>DEMO — publicação fictícia</i>'], published: { 'date-parts': [[2026]] }, URL: 'https://evil.example' }] } })) as FetchLike;
    const records = await fetchMonitor('nejm', f);
    expect(records[0]!.date).toBe('2026');
    expect(records[0]!.title).not.toContain('<');
    expect(records[0]!.description).toBeNull();
    expect(records[0]!.url).toContain('https://doi.org/');
    await expect(fetchMonitor('nao-implementada', f)).rejects.toThrow(/não implementada/);
  });
  it('cadastro exige editor, aparece separado de análises e não inventa vigência', async () => {
    const { app, db } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/monitor/documents', headers: H, payload: official })).statusCode).toBe(401);
    const reader = await login(app, db, 'reader@example.com');
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/monitor/documents', headers: H, cookies: reader, payload: official })).statusCode).toBe(403);
    const editor = await login(app, db, 'admin@example.com');
    const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM analyses')!.n;
    const added = await app.inject({ method: 'POST', url: '/api/v1/admin/monitor/documents', headers: H, cookies: editor, payload: official });
    expect(added.statusCode).toBe(200);
    expect(added.json().stage).toContain('não verificados');
    importOfficial(db, officialInput.parse(official));
    expect(listMonitor(db, 'regulation').items).toHaveLength(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM analyses')!.n).toBe(before);
    expect((await app.inject({ url: '/api/v1/monitor?kind=regulation' })).json().items).toHaveLength(1);
    expect((await app.inject({ url: '/api/v1/monitor?kind=other' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/admin/monitor/sync', headers: H, cookies: editor, payload: { source: 'ms' } })).statusCode).toBe(400);
  });
  it('agenda as fontes implementadas sem duplicar jobs', async () => {
    const { db, cfg } = await setup();
    schedule(db, cfg);
    schedule(db, cfg);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE type='monitor'")!.n).toBe(5);
    expect(enqueue(db, 'monitor', 'manual-test', { source: 'camara' }).created).toBe(true);
  });
});
