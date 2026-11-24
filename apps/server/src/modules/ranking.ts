// Ranking explicável (baseline determinístico). Reordena análises já aprovadas;
// nunca gera texto novo por leitor. O serviço Python é opcional e tem fallback.
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { z } from 'zod';
import { oneVisiblePerArticle, visibility } from './content.ts';

/** Contrato da resposta do serviço Python: tudo validado antes de chegar às rotas. */
const pythonResponse = z.object({
  ranked: z.array(z.object({ id: z.string(), score: z.number(), reasons: z.array(z.string()), matchedTopics: z.array(z.string()) })),
  model_version: z.string().optional(),
});

export interface Candidate {
  id: string; // analysis id
  articleId: string;
  topics: string[]; // slugs do tema e ancestrais
  primaryTopic: string;
  source: string;
  ageDays: number;
  priority: number;
  read: boolean;
  labels?: Record<string, string>;
}
export interface Profile { topics: string[]; sources: string[]; lessTopics: string[]; personalization: boolean }
/** matchedTopics: temas seguidos que o item contém (vazio sem personalização). É o critério do "Para você". */
export interface Ranked { id: string; score: number; reasons: string[]; matchedTopics: string[] }

export const DEFAULT_WEIGHTS = { recency: 0.3, topic: 0.35, source: 0.1, priority: 0.25, halfLifeDays: 7, readPenalty: 0.3, lessPenalty: 0.5, maxPerTopic: 2 };

export function rankCandidates(cands: Candidate[], profile: Profile, k: number, w = DEFAULT_WEIGHTS): Ranked[] {
  const personal = profile.personalization && (profile.topics.length > 0 || profile.sources.length > 0 || profile.lessTopics.length > 0);
  const follows = new Set(profile.topics);
  const less = new Set(profile.lessTopics);
  const scored = cands.map((c) => {
    const reasons: string[] = [];
    const recency = Math.exp((-Math.LN2 * Math.max(0, c.ageDays)) / w.halfLifeDays);
    let s = w.recency * recency + w.priority * Math.max(0, Math.min(1, c.priority));
    const matched = c.topics.find((t) => follows.has(t));
    if (personal && matched) {
      s += w.topic;
      reasons.push(`Você segue ${c.labels?.[matched] ?? matched}`);
    }
    if (personal && follows.size === 0 && profile.sources.includes(c.source)) reasons.push('Fonte que você segue');
    if (personal && profile.sources.includes(c.source)) s += w.source;
    if (personal && c.topics.some((t) => less.has(t))) {
      s -= w.lessPenalty;
      reasons.push('Menos peso: você pediu menos deste tema');
    }
    if (c.read) s -= w.readPenalty;
    if (c.priority >= 0.7) reasons.push('Destaque editorial');
    if (recency > 0.8) reasons.push('Publicado recentemente');
    if (!personal) reasons.push('Seleção geral');
    if (!reasons.length) reasons.push('Seleção editorial recente');
    return { c, s, reasons, matched: !!matched, matchedTopics: personal ? c.topics.filter((t) => follows.has(t)) : [] };
  });
  scored.sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));

  // Diversidade: no máximo N por tema principal e ao menos um item fora dos temas seguidos.
  const out: typeof scored = [];
  const perTopic = new Map<string, number>();
  for (const x of scored) {
    if (out.length >= k) break;
    const n = perTopic.get(x.c.primaryTopic) ?? 0;
    if (n >= w.maxPerTopic) continue;
    perTopic.set(x.c.primaryTopic, n + 1);
    out.push(x);
  }
  if (personal && out.length > 1 && out.every((x) => x.matched)) {
    const outsider = scored.find((x) => !x.matched && !out.includes(x));
    if (outsider) {
      outsider.reasons.push('Para ampliar o olhar: fora dos seus temas');
      out[out.length - 1] = outsider;
    }
  }
  return out.map((x) => ({ id: x.c.id, score: Math.round(x.s * 1000) / 1000, reasons: x.reasons, matchedTopics: x.matchedTopics }));
}

export function loadProfile(db: Db, userId: string | null): Profile {
  if (!userId) return { topics: [], sources: [], lessTopics: [], personalization: false };
  const u = db.get<{ personalization_enabled: number }>('SELECT personalization_enabled FROM users WHERE id = ?', userId);
  // Seguir uma área ou subárea vale para tudo abaixo dela (ex.: seguir "Clínica médica" inclui "Diabetes").
  const topics = db.all<{ slug: string }>(
    `WITH RECURSIVE f(id) AS (
       SELECT p.topic_id FROM user_preferences p WHERE p.user_id = ? AND p.follow = 1 AND p.topic_id IS NOT NULL
       UNION SELECT t.id FROM topics t JOIN f ON t.parent_id = f.id)
     SELECT DISTINCT t.slug FROM f JOIN topics t ON t.id = f.id`, userId,
  ).map((r) => r.slug);
  const sources = db.all<{ slug: string }>('SELECT s.slug FROM user_preferences p JOIN sources s ON s.id = p.source_id WHERE p.user_id = ? AND p.follow = 1', userId).map((r) => r.slug);
  const lessTopics = db.all<{ slug: string }>(
    `SELECT DISTINCT t.slug FROM feedback f JOIN article_topics at ON at.article_id = f.article_id JOIN topics t ON t.id = at.topic_id
      WHERE f.user_id = ? AND f.value = 'less_of_topic'`, userId,
  ).map((r) => r.slug);
  return { topics, sources, lessTopics, personalization: u?.personalization_enabled === 1 };
}

export function loadCandidates(db: Db, userId: string | null, days = 30): Candidate[] {
  const v = visibility(db);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = db.all<{ aid: string; article_id: string; pub_date: string | null; priority: number; source: string }>(
    `SELECT a.id AS aid, a.article_id, ar.pub_date, a.editorial_priority AS priority, s.slug AS source
       FROM analyses a JOIN articles ar ON ar.id = a.article_id JOIN sources s ON s.id = ar.source_id
      WHERE ${v.sql} AND ar.retraction_status <> 'retracted' AND COALESCE(ar.pub_date, '9999') >= ?
        AND ${oneVisiblePerArticle(db).sql}`,
    ...v.params, since, ...oneVisiblePerArticle(db).params,
  );
  const read = new Set(userId ? db.all<{ article_id: string }>('SELECT DISTINCT article_id FROM read_events WHERE user_id = ?', userId).map((r) => r.article_id) : []);
  return rows.map((r) => {
    // tema + subárea + área (para casar com preferências de qualquer nível)
    const chain = db.all<{ slug: string; level: string; label_pt: string }>(
      `WITH RECURSIVE up(id, slug, parent_id, level, label_pt) AS (
         SELECT t.id, t.slug, t.parent_id, t.level, t.label_pt FROM article_topics at JOIN topics t ON t.id = at.topic_id WHERE at.article_id = ?
         UNION SELECT p.id, p.slug, p.parent_id, p.level, p.label_pt FROM topics p JOIN up ON p.id = up.parent_id)
       SELECT DISTINCT slug, level, label_pt FROM up`, r.article_id,
    );
    return {
      id: r.aid,
      articleId: r.article_id,
      topics: chain.map((c) => c.slug),
      primaryTopic: chain.find((c) => c.level === 'tema')?.slug ?? chain[0]?.slug ?? 'geral',
      source: r.source,
      ageDays: r.pub_date ? (Date.now() - Date.parse(r.pub_date)) / 86_400_000 : 30,
      priority: r.priority,
      read: read.has(r.article_id),
      labels: Object.fromEntries(chain.map((c) => [c.slug, c.label_pt])),
    };
  });
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Valida RECOMMENDER_URL: só loopback (http/https), sem credenciais, query ou fragmento. */
export function recommenderEndpoint(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || !LOOPBACK_HOSTS.has(u.hostname)) {
    return null;
  }
  return `${u.origin}${u.pathname.replace(/\/$/, '')}/rank`;
}

/** Tenta o serviço Python; qualquer falha ou atraso cai no baseline. */
export async function recommend(db: Db, cfg: Config, userId: string | null, k = 6, f: typeof fetch = fetch): Promise<{ ranked: Ranked[]; engine: string }> {
  const cands = loadCandidates(db, userId);
  const profile = loadProfile(db, userId);
  const endpoint = cfg.RECOMMENDER_URL ? recommenderEndpoint(cfg.RECOMMENDER_URL) : null;
  if (endpoint) {
    let why = '';
    try {
      const res = await f(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.RECOMMENDER_TOKEN ? { authorization: `Bearer ${cfg.RECOMMENDER_TOKEN}` } : {}) },
        body: JSON.stringify({ candidates: cands, profile, k }),
        redirect: 'error',
        signal: AbortSignal.timeout(800),
      });
      if (!res.ok) why = `HTTP ${res.status}`;
      else {
        const body = pythonResponse.safeParse(await res.json());
        const valid = new Set(cands.map((c) => c.id));
        if (!body.success) why = 'resposta fora do contrato';
        else if (new Set(body.data.ranked.map((r) => r.id)).size !== body.data.ranked.length) why = 'IDs repetidos';
        else if (!body.data.ranked.every((r) => valid.has(r.id))) why = 'ID fora dos candidatos';
        else return { ranked: body.data.ranked.slice(0, k), engine: `python:${body.data.model_version ?? 'desconhecido'}` };
      }
    } catch (e) {
      why = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    // O jornal segue com o baseline, mas a falha fica registrada.
    console.warn(JSON.stringify({ level: 'warn', msg: 'recommender_fallback', reason: why.slice(0, 200) }));
  }
  return { ranked: rankCandidates(cands, profile, k), engine: 'baseline-ts-v1' };
}
