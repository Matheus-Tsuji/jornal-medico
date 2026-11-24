// Provedor OpenAI via HTTP oficial da Responses API, com Structured Outputs (JSON Schema estrito).
// https://platform.openai.com/docs/guides/structured-outputs
import { z } from 'zod';
import { safeFetch, TransientError, type FetchLike } from '../lib/net.ts';

/** Teto por chamada de IA: 4 chamadas por artigo (triagem, 2 extrações, redação) cabem no ciclo da Vercel. */
export const AI_CALL_TIMEOUT_MS = 45_000;

export interface Usage { inputTokens: number; cachedTokens: number; outputTokens: number }
export interface StructuredCall<T> { model: string; system: string; user: string; name: string; schema: z.ZodType<T>; maxOutputTokens: number }

export interface AiProvider {
  structured<T>(call: StructuredCall<T>): Promise<{ data: unknown; parsed: T | null; parseError: string | null; usage: Usage; refusal: string | null }>;
}

/** Converte zod → JSON Schema aceito pelo modo estrito (sem $schema e sem limites de inteiro seguro). */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }) as Record<string, unknown>;
  delete js.$schema;
  const clean = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(clean);
    if (n && typeof n === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) {
        if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) continue;
        o[k] = clean(v);
      }
      return o;
    }
    return n;
  };
  return clean(js) as Record<string, unknown>;
}

export function openAiProvider(apiKey: string, f: FetchLike = fetch): AiProvider {
  return {
    async structured<T>(c: StructuredCall<T>) {
      const res = await safeFetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        timeoutMs: AI_CALL_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: c.model,
          store: false,
          max_output_tokens: c.maxOutputTokens,
          input: [
            { role: 'system', content: c.system },
            { role: 'user', content: c.user },
          ],
          text: { format: { type: 'json_schema', name: c.name, schema: strictJsonSchema(c.schema), strict: true } },
        }),
      }, f);
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; type?: string };
        status?: string;
        incomplete_details?: { reason?: string };
        output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
      };
      if (!res.ok) {
        const msg = body.error?.message ?? `HTTP ${res.status}`;
        if (res.status === 408 || res.status === 409) throw new TransientError(`OpenAI: ${msg}`);
        throw new Error(`OpenAI: ${msg}`);
      }
      const usage: Usage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        cachedTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
      const parts = (body.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
      const refusal = parts.find((p) => p.type === 'refusal')?.refusal ?? null;
      const text = parts.filter((p) => p.type === 'output_text').map((p) => p.text ?? '').join('');
      if (body.status === 'incomplete') return { data: null, parsed: null, parseError: `Resposta incompleta: ${body.incomplete_details?.reason ?? 'desconhecido'}`, usage, refusal };
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        return { data: null, parsed: null, parseError: 'JSON inválido na resposta', usage, refusal };
      }
      const p = c.schema.safeParse(data);
      return { data, parsed: p.success ? p.data : null, parseError: p.success ? null : p.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), usage, refusal };
    },
  };
}
