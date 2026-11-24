import { expect, it, vi } from 'vitest';
import { Db, migrate } from '../src/db/index.ts';

it('ignora migrações concluídas por outra inicialização antes da transação', () => {
  const db = new Db(':memory:');
  try {
    const transaction = db.tx.bind(db);
    vi.spyOn(db, 'tx').mockImplementationOnce((apply) => {
      expect(migrate(db).length).toBeGreaterThan(0);
      return transaction(apply);
    });
    expect(migrate(db)).toEqual([]);
  } finally {
    db.close();
  }
});
