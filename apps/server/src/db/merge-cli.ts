// Passo do deploy (npm run build:vercel): funde o conteúdo da vitrine do Git no banco de produção (Turso).
// As credenciais do Turso vêm do ambiente de build da Vercel; a rotina agendada nunca as vê.
// - Só roda na produção da Vercel (ou fora dela, se o banco remoto estiver configurado): preview não escreve em produção.
// - Falha NÃO derruba o deploy (o site continua no ar com o conteúdo que já tem); MERGE_STRICT=1 inverte isso.
import { copyFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRemote, openDb, REPO_ROOT } from './index.ts';
import { mergeContent } from './merge.ts';

const strict = process.env.MERGE_STRICT === '1';
const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
const token = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

if (!url || !isRemote(url)) {
  console.log('merge-vitrine: sem banco remoto configurado; nada a fazer.');
} else if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
  console.log(`merge-vitrine: ambiente "${process.env.VERCEL_ENV}" não escreve em produção; nada a fazer.`);
} else {
  try {
    const file = join(REPO_ROOT, 'apps/server/data/vitrine.db');
    if (!existsSync(file)) throw new Error('apps/server/data/vitrine.db não existe.');
    // Cópia em pasta temporária: abrir o banco aplica migrações e cria arquivos -wal, e o do repositório não deve mudar.
    const tmp = join(mkdtempSync(join(tmpdir(), 'merge-')), 'vitrine.db');
    copyFileSync(file, tmp);
    const src = openDb(tmp);
    const dst = openDb(url, token);
    const r = mergeContent(src, dst);
    src.close();
    dst.close();
    console.log('merge-vitrine OK:', JSON.stringify(r));
  } catch (e) {
    // Nunca imprime a URL nem o token.
    console.error('merge-vitrine FALHOU (o conteúdo novo não entrou no banco de produção):', e instanceof Error ? e.message : String(e));
    if (strict) process.exit(1);
  }
}
