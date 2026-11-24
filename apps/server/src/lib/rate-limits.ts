import type { Db } from '../db/index.ts';
import { setTimeout as delay } from 'node:timers/promises';
import type { FetchLike } from './net.ts';

/** A janela começa na primeira chamada. O UPSERT mantém o teto entre processos. */
export function takeSlot(db: Db, key: string, max: number, windowMs: number, now = Date.now()): boolean {
  return db.run(
    `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
       expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
     WHERE expires_at <= ? OR count < ?`,
    key, now + windowMs, now, now, now, max,
  ).changes === 1;
}

export function sourceFetch(db: Db, source: string, gapMs: number): FetchLike {
  const key = `source:${source}`;
  return async (input, init) => {
    const signal = init?.signal ?? undefined;
    signal?.throwIfAborted();
    while (!takeSlot(db, key, 1, gapMs)) {
      const slot = db.get<{ expires_at: number }>('SELECT expires_at FROM rate_limits WHERE key = ?', key);
      await delay(Math.max(1, (slot?.expires_at ?? Date.now()) - Date.now()), undefined, { signal });
    }
    return fetch(input, init);
  };
}
