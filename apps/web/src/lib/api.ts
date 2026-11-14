// Cliente HTTP da API. Toda ação real passa por aqui (sem dados fixos nos componentes).
import { useQuery } from '@tanstack/react-query';
import type { Me, PublicConfig, Topic } from '@jm/contracts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.method && opts.method !== 'GET' ? { 'x-requested-with': 'jornal-medico' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  const data = (await res.json().catch(() => null)) as (T & { code?: string; message?: string; requestId?: string }) | null;
  if (!res.ok) {
    const fallback = res.status >= 500 ? 'O servidor está indisponível no momento. Tente de novo em instantes.' : 'Algo deu errado.';
    throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? fallback, data?.requestId);
  }
  return data as T;
}

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config'), staleTime: 5 * 60_000 });

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

export const useTopics = () => useQuery({ queryKey: ['topics'], queryFn: () => api<Topic[]>('/topics'), staleTime: 10 * 60_000 });

// ---------- formatação pt-BR ----------
const tz = 'America/Sao_Paulo';
export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...opts }).format(d);
}
export const fmtLongDate = (iso: string) => fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDateTime = (iso: string | null | undefined) => fmtDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtBRL = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
/** Número com vírgula decimal, sem arredondar além do que veio. */
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(n).replace('.', ','));

const decimals = (n: number) => (String(n).split('.')[1] ?? '').length;
/** Valor estruturado no padrão brasileiro, mantendo as casas decimais do texto da fonte (ex.: "0.80" → "0,80"). */
/** Texto da fonte em inglês com separadores brasileiros: "1,443.0" → "1.443,0"; "301.0" → "301,0". Os dígitos não mudam. */
export const brNums = (s: string) =>
  s.replace(/\d+(?:,\d{3})*(?:\.\d+)?/g, (m) => m.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.')));

export function fmtVal(v: number | null | undefined, raw?: string | null): string {
  if (v === null || v === undefined) return raw ? brNums(raw) : '—';
  const g = raw?.match(/[.,](\d+)\D*$/)?.[1];
  const d = Number.isInteger(v) ? 0 : Math.max(decimals(v), g && g.length !== 3 ? g.length : 0);
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 6) }).format(v);
}
/** Intervalo de confiança "0,64 a 0,95" com as mesmas casas nos dois limites. */
export function fmtCi(ci: { lower: number; upper: number }): string {
  const d = Math.max(decimals(ci.lower), decimals(ci.upper));
  const f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 6) });
  return `${f.format(ci.lower)} a ${f.format(ci.upper)}`;
}
const OPS: Record<string, string> = { '=': '=', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };
/** p-valor preservando a desigualdade da fonte: "P<0.001" → "p < 0,001". */
export const fmtP = (p: { operator: string; value: number } | null | undefined, raw?: string | null) =>
  p ? `p ${OPS[p.operator] ?? p.operator} ${fmtVal(p.value, raw)}` : raw ? brNums(raw) : null;
