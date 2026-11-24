// Execução manual do pipeline. Ex.: npm run pipeline -- discover hipertensao-arterial
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { localDate } from '../lib/util.ts';
import { PROMPT_VERSION, analyzeArticle, buildDocument } from '../ai/analysis.ts';
import { validateAnalysis } from '../ai/validator.ts';
import { resultRow } from '../modules/content.ts';
import { json } from '../db/index.ts';
import type { AiAnalysis } from '@jm/contracts';
import { composeEdition } from '../modules/editorial.ts';
import { defaultDeps, runCycle, schedule, workOnce } from './runner.ts';
import { enqueue, requeue } from '../modules/jobs.ts';
import { automaticSources, syncMonitor } from '../modules/monitor.ts';
import { discover } from './ingestion.ts';
import { exportPending, importAnalyses } from '../ai/handoff.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg.dbPath, cfg.DATABASE_AUTH_TOKEN);
const deps = defaultDeps(cfg);
const out = (x: unknown) => console.log(JSON.stringify(x, null, 2));

switch (cmd) {
  case 'monitor':
    for (const source of arg ? [arg] : automaticSources) out(await syncMonitor(db, source));
    break;
  case 'discover': {
    // discover <tema> [fonte]   ex.: discover hipertensao-arterial europepmc
    const src = process.argv[4];
    const adapter = src ? deps.extraAdapters?.find((a) => a.slug === src) : deps.adapter;
    if (!adapter) throw new Error(`Fonte sem adaptador: ${src}`);
    out(await discover(db, cfg, adapter, arg ?? 'hipertensao-arterial'));
    break;
  }
  case 'analyze':
    out(await analyzeArticle(db, cfg, deps.provider, arg ?? ''));
    break;
  case 'claude-export': {
    // claude-export ARQUIVO [N]: documentos pendentes + prompts, para o Claude da rotina escrever as análises (sem chave de API).
    if (!arg) throw new Error('Uso: claude-export ARQUIVO.json [N]');
    const r = exportPending(db, Number(process.argv[4] ?? 10));
    writeFileSync(arg, JSON.stringify(r, null, 2));
    out({ file: arg, items: r.items.length, promptVersion: r.promptVersion });
    break;
  }
  case 'claude-import': {
    // claude-import ARQUIVO: revalida e grava como rascunho (in_review/blocked); nunca publica.
    if (!arg) throw new Error('Uso: claude-import ARQUIVO.json');
    out(importAnalyses(db, JSON.parse(readFileSync(arg, 'utf8'))));
    break;
  }
  case 'compose':
    out(composeEdition(db, arg ?? localDate(cfg.APP_TIMEZONE)));
    break;
  case 'schedule':
    schedule(db, cfg);
    out(db.all("SELECT type, idempotency_key, status FROM jobs WHERE status IN ('queued','retry') ORDER BY created_at"));
    break;
  case 'cycle': {
    // Um ciclo diário completo, igual ao cron da Vercel. Ex.: npm run pipeline -- cycle 240 (segundos de orçamento).
    const r = await runCycle(db, cfg, deps, { workerId: `cli:${process.pid}`, budgetMs: Number(arg ?? 240) * 1000, concurrency: cfg.CYCLE_CONCURRENCY });
    out(r);
    break;
  }
  case 'run': {
    let n = 0;
    while (await workOnce(db, cfg, deps, `cli:${process.pid}`)) n++;
    out({ processed: n, jobs: db.all('SELECT type, status, last_error FROM jobs ORDER BY updated_at DESC LIMIT 20') });
    break;
  }
  case 'revalidate': {
    // Reaplica o validador atual às análises pendentes (sem chamar a IA). Útil quando o validador melhora.
    const rows = db.all<{ id: string; payload: string; article_id: string }>("SELECT id, payload, article_id FROM analyses WHERE status IN ('in_review','blocked') AND is_demo = 0");
    let changed = 0;
    for (const r of rows) {
      const art = db.get<{ original_title: string; journal: string | null; publication_types: string; pub_date: string | null }>(
        'SELECT ar.original_title, j.title AS journal, ar.publication_types, ar.pub_date FROM articles ar LEFT JOIN journals j ON j.id = ar.journal_id WHERE ar.id = ?', r.article_id)!;
      const abs = db.get<{ abstract_text: string | null }>('SELECT abstract_text FROM article_sources WHERE article_id = ? ORDER BY retrieved_at DESC LIMIT 1', r.article_id)?.abstract_text;
      if (!abs) continue;
      const p = json<AiAnalysis>(r.payload, {} as AiAnalysis);
      const full: AiAnalysis = {
        ...p,
        reviewFlags: p.reviewFlags.filter((f) => f !== 'numeric_uncertainty' && f !== 'possible_prompt_injection'),
        results: db.all('SELECT * FROM evidence_results WHERE analysis_id = ? ORDER BY ord', r.id).map(resultRow),
        claims: db.all('SELECT text, locator, quote, support, origin FROM claims WHERE analysis_id = ? ORDER BY ord', r.id) as unknown as AiAnalysis['claims'],
      };
      const rep = validateAnalysis(full, buildDocument(art, abs), p.inputScope);
      db.run('UPDATE analyses SET validation = ?, payload = ? WHERE id = ?', JSON.stringify([...rep.errors, ...rep.warnings]), JSON.stringify({ ...p, reviewFlags: rep.flags }), r.id);
      changed++;
    }
    out({ revalidated: changed });
    break;
  }
  case 'reanalyze': {
    // Reprocessa com o PROMPT_VERSION atual os artigos reais que têm rascunho (em revisão ou bloqueado). Publicadas ficam como estão.
    const ids = db.all<{ article_id: string }>("SELECT DISTINCT article_id FROM analyses WHERE is_demo = 0 AND status IN ('in_review','blocked') AND prompt_version <> ?", PROMPT_VERSION);
    ids.forEach((r) => enqueue(db, 'analyze', `analyze:${r.article_id}:${PROMPT_VERSION}`, { articleId: r.article_id }));
    out({ enqueued: ids.length, promptVersion: PROMPT_VERSION });
    break;
  }
  case 'retry-blocked': {
    // Reenfileira jobs bloqueados/falhos (ex.: depois de configurar a chave da OpenAI).
    const ids = db.all<{ id: string }>("SELECT id FROM jobs WHERE status IN ('blocked','failed')").map((r) => r.id);
    ids.forEach((id) => requeue(db, id));
    out({ requeued: ids.length });
    break;
  }
  default:
    console.log('Uso: pipeline <monitor [FONTE] | discover TEMA | analyze ARTICLE_ID | compose [YYYY-MM-DD] | schedule | cycle [SEGUNDOS] | retry-blocked | claude-export ARQ [N] | claude-import ARQ | reanalyze | revalidate | run>');
    process.exitCode = 1;
}
db.close();
