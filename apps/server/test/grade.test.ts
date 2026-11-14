import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { seed } from '../src/db/seed.ts';
import { byBestEvidence, gradeEvidence, rankBest, syncQualis } from '../src/modules/grade.ts';
import { testConfig } from './helpers.ts';

const base = { design: 'rct' as const, sampleSize: 1200, hasPrecision: true, flags: [], retracted: false };

describe('força da evidência', () => {
  it('letra pelo desenho, número por precisão, amostra e incerteza', () => {
    expect(gradeEvidence(base).grade).toBe('A1');
    expect(gradeEvidence({ ...base, sampleSize: 80 }).grade).toBe('A2');
    expect(gradeEvidence({ ...base, sampleSize: null, hasPrecision: false }).grade).toBe('A3');
    expect(gradeEvidence({ ...base, design: 'cohort' }).grade).toBe('B1');
    expect(gradeEvidence({ ...base, design: 'case_report', sampleSize: 1 }).grade).toBe('C2');
    expect(gradeEvidence({ ...base, flags: ['numeric_uncertainty'] }).grade).toBe('A2');
    expect(gradeEvidence({ ...base, retracted: true }).grade).toBe('C3');
    expect(gradeEvidence(base).reasons[0]).toMatch(/Ensaio clínico randomizado/);
  });
  it('ordena por nota, depois Qualis (sem Qualis por último), depois prioridade', () => {
    const s = (grade: string, stratum: string | null, priority = 0) => ({ grade, reasons: [], qualis: stratum ? { stratum, cycle: '' } : null, priority }) as never;
    const list = [s('B1', 'A1'), s('A2', null), s('A2', 'B1'), s('A2', 'A4'), s('A2', 'A4', 0.9)];
    expect(list.sort(byBestEvidence).map((x: { grade: string; qualis: { stratum: string } | null; priority: number }) => `${x.grade}/${x.qualis?.stratum ?? '-'}/${x.priority}`))
      .toEqual(['A2/A4/0.9', 'A2/A4/0', 'A2/B1/0', 'A2/-/0', 'B1/A1/0']);
  });
});

describe('Qualis e capa', () => {
  it('liga revista ao Qualis pelo ISSN eletrônico ou impresso, sem duplicar', () => {
    const db = openDb(':memory:');
    seed(db, testConfig());
    db.run("INSERT INTO journals (id, title, issn, eissn, created_at) VALUES ('j1', 'Renal failure', NULL, '1525-6049', 'x')");
    db.run("INSERT INTO journals (id, title, issn, eissn, created_at) VALUES ('j2', 'Sem Qualis', NULL, '2149-2271', 'x')");
    expect(syncQualis(db)).toBe(1);
    expect(syncQualis(db)).toBe(0);
    expect(db.get<{ stratum: string }>("SELECT stratum FROM journal_classifications WHERE journal_id = 'j1'")!.stratum).toBe('A2');
    expect(db.get("SELECT 1 FROM journal_classifications WHERE journal_id = 'j2'")).toBeUndefined();
  });
  it('rankBest coloca a demonstração mais forte primeiro', () => {
    const db = openDb(':memory:');
    seed(db, testConfig());
    const ids = db.all<{ id: string }>("SELECT id FROM analyses WHERE is_demo = 1").map((r) => r.id);
    const ranked = rankBest(db, ids);
    expect(ranked).toHaveLength(ids.length);
    const designs = ranked.map((a) => JSON.parse(db.get<{ payload: string }>('SELECT payload FROM analyses WHERE id = ?', a)!.payload).studyDesign);
    expect(['rct', 'cluster_rct', 'meta_analysis', 'systematic_review']).toContain(designs[0]);
  });
});
