/* global process, console */
// Monta .vercel/output (Build Output API v3): site estático + uma função Node com a API + o cron.
// Rodar depois do build da web: `npm run build:vercel`.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const OUT = '.vercel/output';
const FUNC = join(OUT, 'functions/api.func');
// Hobby: no máximo 1 execução por dia. No Pro, troque por "0 * * * *" (de hora em hora) ou via VERCEL_CRON_SCHEDULE.
const CRON_SCHEDULE = process.env.VERCEL_CRON_SCHEDULE || '0 9 * * *'; // 09:00 UTC = 06:00 em Brasília

if (!existsSync('apps/web/dist/index.html')) throw new Error('Rode antes o build da web (npm run build).');
rmSync(OUT, { recursive: true, force: true });

// 1) Site estático
cpSync('apps/web/dist', join(OUT, 'static'), { recursive: true });

// 2) Função: código num arquivo só; libsql fica de fora porque tem binário nativo.
await build({
  entryPoints: ['apps/server/src/api/vercel.ts'],
  outfile: join(FUNC, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['libsql'],
  logLevel: 'warning',
  banner: {
    // require para dependências CommonJS empacotadas; JM_ROOT aponta para os arquivos de dados copiados abaixo.
    js: [
      "import { createRequire as __jmReq } from 'node:module';",
      "import { fileURLToPath as __jmPath } from 'node:url';",
      'const require = __jmReq(import.meta.url);',
      "process.env.JM_ROOT ??= __jmPath(new URL('./root', import.meta.url));",
    ].join('\n'),
  },
});

// Arquivos lidos em tempo de execução (migrações, prompts, preços de IA, tabela Qualis).
for (const dir of ['apps/server/src/db/migrations', 'apps/server/src/ai/prompts', 'apps/server/config', 'apps/server/data']) {
  cpSync(dir, join(FUNC, 'root', dir), { recursive: true });
}

// Vitrine: segredo novo a cada deploy, gravado só na cópia que vai dentro do pacote (nunca no Git). Assim todas
// as instâncias da função assinam e validam as sessões de visitante com o mesmo segredo.
{
  const Database = createRequire(import.meta.url)('libsql');
  const v = new Database(join(FUNC, 'root/apps/server/data/vitrine.db'));
  for (const name of ['session_secret', 'payment_webhook_secret']) {
    v.prepare('INSERT OR REPLACE INTO app_secrets (name, value, created_at) VALUES (?,?,?)').run(name, randomBytes(32).toString('hex'), new Date().toISOString());
  }
  v.close();
}

// libsql e as dependências dele, incluindo o binário da plataforma instalado (linux-x64-gnu na Vercel).
const copied = new Set();
function copyPkg(name) {
  if (copied.has(name)) return;
  const src = join('node_modules', name);
  if (!existsSync(src)) return; // dependência opcional de outra plataforma
  copied.add(name);
  cpSync(src, join(FUNC, 'node_modules', name), { recursive: true, dereference: true });
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) copyPkg(dep);
}
copyPkg('libsql');

writeFileSync(join(FUNC, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  maxDuration: 300,
}, null, 2));

// 3) Rotas e cron
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(api/.*|health)$', dest: '/api' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
  crons: [{ path: '/api/v1/cron/tick', schedule: CRON_SCHEDULE }],
}, null, 2));

console.log(`Vercel: ${OUT} pronto (função api + estático; pacotes nativos: ${[...copied].join(', ')}; cron "${CRON_SCHEDULE}").`);
