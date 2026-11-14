// Configuração da IA sem expor a chave.
//   npm run ai -- models   → lista os modelos disponíveis no SEU projeto OpenAI (para escolher os IDs)
//   npm run ai -- ping     → chamada mínima com saída estruturada estrita usando os modelos do .env
// Não grava nada no banco e nunca imprime a chave.
import { loadConfig } from '../config.ts';
import { safeFetch } from '../lib/net.ts';
import { openAiProvider } from './provider.ts';
import { editorialSchema } from './analysis.ts';

const key = process.env.OPENAI_API_KEY?.trim();
const cmd = process.argv[2];

if (!key) {
  console.error('OPENAI_API_KEY não encontrada no .env da pasta jornal-medico. Adicione a linha OPENAI_API_KEY=... e rode de novo.');
  process.exit(1);
}

if (cmd === 'models') {
  const res = await safeFetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string; created: number }[]; error?: { message?: string } };
  if (!res.ok) {
    console.error(`OpenAI respondeu ${res.status}: ${body.error?.message ?? 'erro desconhecido'}`);
    process.exit(1);
  }
  const ids = (body.data ?? []).sort((a, b) => b.created - a.created).map((m) => m.id);
  console.log(`${ids.length} modelos disponíveis neste projeto (mais recentes primeiro):`);
  for (const id of ids) console.log(`  ${id}`);
} else if (cmd === 'ping') {
  loadConfig();
  const models = { OPENAI_ANALYSIS_MODEL: process.env.OPENAI_ANALYSIS_MODEL, OPENAI_EDITORIAL_MODEL: process.env.OPENAI_EDITORIAL_MODEL };
  const provider = openAiProvider(key);
  for (const [name, model] of Object.entries(models)) {
    if (!model) {
      console.log(`${name}: não definido no .env`);
      continue;
    }
    // Texto sintético e inofensivo; testa só a conexão e o modo estrito.
    const r = await provider.structured({
      model,
      system: 'Responda somente com o objeto do schema, em português. Use null quando não houver informação.',
      user: '<extracao>{"teste": "conexão", "observacao": "nenhum estudo real"}</extracao>',
      name: 'editorial_text',
      schema: editorialSchema,
      maxOutputTokens: 400,
    }).catch((e: Error) => ({ parsed: null, parseError: e.message, usage: null, refusal: null }));
    console.log(`${name} (${model}): ${r.parsed ? 'OK — saída estruturada válida' : `FALHOU — ${r.parseError ?? r.refusal}`}${r.usage ? ` · tokens ${r.usage.inputTokens}/${r.usage.outputTokens}` : ''}`);
  }
} else {
  console.log('Uso: npm run ai -- <models | ping>');
  process.exitCode = 1;
}
