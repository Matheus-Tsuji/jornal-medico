// Copia todas as tabelas de um banco para outro (ex.: cópia limpa local → Turso). O destino já tem o esquema
// (openDb aplica as migrações). Insere em lotes para poucas idas e voltas na rede.
import type { Db, Params } from './index.ts';

const BATCH = 50;

export function copyDb(src: Db, dst: Db, log: (msg: string) => void = () => {}): Record<string, number> {
  // Ordem de criação: tabelas-pai antes das filhas (apaga na ordem inversa).
  const tables = src
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY rowid")
    .map((t) => t.name);
  const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
  for (const t of [...tables].reverse()) dst.run(`DELETE FROM ${q(t)}`);
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const rows = src.all(`SELECT * FROM ${q(t)}`);
    counts[t] = rows.length;
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!);
    const one = `(${cols.map(() => '?').join(',')})`;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      dst.run(`INSERT INTO ${q(t)} (${cols.map(q).join(',')}) VALUES ${chunk.map(() => one).join(',')}`, ...(chunk.flatMap((r) => cols.map((c) => r[c])) as Params));
    }
    log(`${t}: ${rows.length}`);
  }
  return counts;
}
