// Semente idempotente: taxonomia, fontes, planos, flags e edição de DEMONSTRAÇÃO.
import { IMPLEMENTED_FLAGS } from '../modules/audit.ts';
import type { AiAnalysis } from '@jm/contracts';
import type { Config } from '../config.ts';
import type { Db } from './index.ts';
import { demoArticles, flags, plans, sources, taxonomy } from './seed-data.ts';
import { insertAnalysis } from '../modules/analyses.ts';
import { addDays, id, localDate, nowIso, sha256 } from '../lib/util.ts';
import { syncQualis } from '../modules/grade.ts';

export function seed(db: Db, cfg: Config): { demoArticles: number } {
  const now = nowIso();
  db.tx(() => {
    // Taxonomia
    let sort = 0;
    const slugToId = new Map<string, string>(db.all<{ id: string; slug: string }>('SELECT id, slug FROM topics').map((r) => [r.slug, r.id]));
    const walk = (nodes: typeof taxonomy, parent: string | null, level: number) => {
      for (const n of nodes) {
        const lvl = (['area', 'subarea', 'tema'] as const)[level]!;
        if (!slugToId.has(n.slug)) {
          const tid = id();
          db.run(
            `INSERT INTO topics (id, parent_id, slug, level, label_pt, label_en, synonyms, mesh_terms, source_query, color, enabled, sort)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            tid, parent ? slugToId.get(parent)! : null, n.slug, lvl, n.label, n.en ?? null, JSON.stringify(n.syn ?? []),
            JSON.stringify(n.mesh ?? []), n.query ?? null, n.color ?? null, n.enabled ? 1 : 0, sort++,
          );
          slugToId.set(n.slug, tid);
        } else {
          // Taxonomia do código é a fonte da verdade: sincroniza habilitação, consulta (versionada) e rótulos.
          db.run(
            `UPDATE topics SET enabled = ?, label_pt = ?, color = ?, mesh_terms = ?,
               query_version = CASE WHEN COALESCE(source_query, '') <> COALESCE(?, '') THEN query_version + 1 ELSE query_version END,
               source_query = ? WHERE slug = ?`,
            n.enabled ? 1 : 0, n.label, n.color ?? null, JSON.stringify(n.mesh ?? []), n.query ?? null, n.query ?? null, n.slug,
          );
        }
        if (n.children) walk(n.children, n.slug, level + 1);
      }
    };
    walk(taxonomy, null, 0);
    const linkExtras = (nodes: typeof taxonomy) => {
      for (const n of nodes) {
        if (n.extra) db.run('UPDATE topics SET extra_parents = ? WHERE slug = ?', JSON.stringify(n.extra.map((s) => slugToId.get(s))), n.slug);
        if (n.children) linkExtras(n.children);
      }
    };
    linkExtras(taxonomy);

    for (const s of sources) {
      db.run(
        `INSERT OR IGNORE INTO sources (id, slug, name, kind, official_url, license_notes, status, rate_limit_per_sec, enabled) VALUES (?,?,?,?,?,?,?,?,?)`,
        id(), s.slug, s.name, s.kind, s.url, s.license, s.status, s.rate, s.enabled,
      );
    }
    for (const p of plans) {
      db.run('INSERT OR IGNORE INTO plans (id, slug, name, description, price_cents, active) VALUES (?,?,?,?,?,?)', id(), p.slug, p.name, p.description, p.price, p.active);
    }
    for (const f of flags) {
      const envOn = IMPLEMENTED_FLAGS.includes(f.key) && ['true', '1'].includes(String(process.env[f.env] ?? ''));
      db.run('INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES (?,?,?,?)', f.key, envOn ? 1 : 0, f.description, now);
    }
  });

  seedDemo(db, cfg);
  syncQualis(db);
  return { demoArticles: demoArticles.length };
}

function seedDemo(db: Db, cfg: Config) {
  if (db.get('SELECT 1 FROM articles WHERE is_demo = 1 LIMIT 1')) return;
  const demoSource = db.get<{ id: string }>("SELECT id FROM sources WHERE slug = 'demo'")!.id;
  const now = nowIso();
  db.tx(() => {
    const journalId = id();
    db.run('INSERT INTO journals (id, title, created_at) VALUES (?,?,?)', journalId, 'Revista Fictícia de Demonstração', now);
    const today = localDate(cfg.APP_TIMEZONE);
    const yesterday = localDate(cfg.APP_TIMEZONE, new Date(Date.now() - 86_400_000));
    const editions: Record<'today' | 'yesterday', { id: string; date: string; pos: number }> = {
      yesterday: { id: id(), date: yesterday, pos: 0 },
      today: { id: id(), date: today, pos: 0 },
    };
    let n = 1;
    for (const k of ['yesterday', 'today'] as const) {
      const e = editions[k];
      db.run(
        `INSERT INTO editions (id, edition_date, version, number, status, is_demo, coverage_note, composed_at, published_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        e.id, e.date, 1, n++, 'published', 1, 'Edição de demonstração com estudos fictícios.', now, now,
      );
    }
    for (const d of demoArticles) {
      const articleId = id();
      const pub = addDays(now, -d.daysAgo).slice(0, 10);
      db.run(
        `INSERT INTO articles (id, slug, original_title, authors, journal_id, source_id, publication_types, pub_date, indexed_at, canonical_url, access_status, retraction_status, language, triage_status, is_demo, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        articleId, d.code.toLowerCase(), d.title, JSON.stringify(['Autoria fictícia A', 'Autoria fictícia B', 'Grupo de demonstração']),
        journalId, demoSource, JSON.stringify(d.pubTypes), pub, pub, null, 'demo', d.retracted ? 'retracted' : 'none', 'pt', 'eligible', 1, now, now,
      );
      db.run(
        'INSERT INTO article_sources (id, article_id, source_id, external_id, retrieved_at, content_hash, license) VALUES (?,?,?,?,?,?,?)',
        id(), articleId, demoSource, d.code, now, sha256(d.code), 'demo-fictitious',
      );
      for (const t of d.topics) {
        db.run("INSERT INTO article_topics (article_id, topic_id, method, confidence) SELECT ?, id, 'fixture', 1 FROM topics WHERE slug = ?", articleId, t);
      }
      if (d.retracted) {
        db.run('INSERT INTO article_corrections (id, article_id, kind, note, created_at) VALUES (?,?,?,?,?)', id(), articleId, 'retraction', 'Aviso fictício de retratação (demonstração).', now);
      }
      const analysis: AiAnalysis = {
        inputScope: d.code === 'DEMO-008' ? 'abstract_only' : 'full_text',
        language: 'pt-BR',
        editorialHeadline: d.headline,
        summary: d.summary,
        inShort: d.inShort,
        plainResult: null,
        context: d.context,
        objective: d.objective,
        studyDesign: d.design,
        population: { description: d.population, sampleSize: d.sampleSize, followUp: d.followUp },
        interventionOrExposure: d.intervention,
        comparator: d.comparator,
        methods: d.methods,
        results: d.results.map((r) => ({
          outcome: r.outcome, outcomeType: r.outcomeType ?? 'unknown', measure: r.measure ?? null, measureKind: r.measureKind ?? null,
          estimate: r.estimate ?? null, estimateRaw: r.estimateRaw ?? null, unit: r.unit ?? null, comparator: r.comparator ?? null,
          population: r.population ?? null, timepoint: r.timepoint ?? null, confidenceInterval: r.confidenceInterval ?? null,
          pValue: r.pValue ?? null, sampleSize: r.sampleSize ?? null, adjusted: r.adjusted ?? null,
          evidenceRef: { locator: 'result', quote: 'Valor fictício de demonstração' }, missingReason: r.missingReason ?? null,
        })),
        clinicalImplications: d.implications,
        applicability: d.applicability,
        limitations: d.limitations,
        riskOfBias: d.rob ? { status: 'preliminary_signals', method: null, rationale: d.rob } : { status: 'not_assessed', method: null, rationale: null },
        funding: d.funding,
        conflictsOfInterest: d.coi,
        claims: [
          { text: d.inShort, locator: 'result', quote: 'Texto fictício de demonstração', support: 'editorial_interpretation', origin: 'editorial' },
        ],
        missingFields: d.missing ?? [],
        reviewFlags: d.flags ?? [],
        editorialPriority: { score: d.priority, rationale: 'Prioridade fictícia de demonstração.' },
      };
      const analysisId = insertAnalysis(db, articleId, analysis, {
        model: 'demo-fixture', promptVersion: 'demo', inputHash: sha256(d.code), status: d.status, validation: [], isDemo: true,
      });
      if (d.status === 'demo') db.run('UPDATE analyses SET published_at = ? WHERE id = ?', now, analysisId);
      if (d.edition !== 'none') {
        const e = editions[d.edition];
        const topicId = db.get<{ id: string }>('SELECT parent_id AS id FROM topics WHERE slug = ?', d.topics[0]!)!.id;
        db.run(
          'INSERT INTO edition_items (edition_id, analysis_id, article_id, slot, section_topic_id, position) VALUES (?,?,?,?,?,?)',
          e.id, analysisId, articleId, d.slot ?? 'section', topicId, e.pos++,
        );
      }
    }
  });
}
