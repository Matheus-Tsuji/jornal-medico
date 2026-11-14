// Saída de rede restrita: só hosts da allowlist, sem redirecionamentos, com timeout.
// Nenhuma rotina generativa recebe esta função; URLs vindas de documentos nunca são buscadas.
import { AppError } from './util.ts';

const ALLOWED_HOSTS = new Set(['eutils.ncbi.nlm.nih.gov', 'api.openai.com', 'api.resend.com', 'dadosabertos.camara.leg.br', 'api.crossref.org']);

export class TransientError extends Error {
  constructor(message: string, public retryAfterMs?: number) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

export async function safeFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}, f: FetchLike = fetch): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new AppError(400, 'host_not_allowed', `Host não autorizado: ${u.hostname}`);
  }
  let res: Response;
  try {
    res = await f(u, { ...init, redirect: 'error', signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  } catch (e) {
    throw new TransientError(`Falha de rede/timeout em ${u.hostname}: ${(e as Error).name}`);
  }
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get('retry-after'));
    throw new TransientError(`HTTP ${res.status} em ${u.hostname}`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  return res;
}
