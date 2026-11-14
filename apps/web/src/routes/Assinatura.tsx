import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Plan, SubscriptionDto } from '@jm/contracts';
import { api, ApiError, fmtBRL, fmtDate, useConfig, useMe } from '../lib/api';
import { ErrorState, Loading, PageTitle } from '../components/ui';

const statusLabel: Record<SubscriptionDto['status'], string> = {
  none: 'Sem assinatura', incomplete: 'Pagamento pendente', trialing: 'Em período de teste', active: 'Ativa', past_due: 'Pagamento atrasado (em carência)', canceled: 'Cancelada',
};

export function Assinatura() {
  const me = useMe();
  const cfg = useConfig();
  const nav = useNavigate();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<{ items: Plan[]; sandbox: boolean }>('/billing/plans') });
  const sub = useQuery({ queryKey: ['subscription', me.data?.id], enabled: !!me.data, queryFn: () => api<SubscriptionDto>('/billing/subscription') });
  const checkout = useMutation({ mutationFn: (planId: string) => api<{ url: string }>('/billing/checkout', { method: 'POST', body: { planId } }), onSuccess: (r) => nav(r.url) });
  const cancel = useMutation({ mutationFn: () => api('/billing/cancel', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription'] }) });

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10">
      <PageTitle kicker="Sem anúncios" title="Assinatura">
        O jornal é mantido por assinatura, não por publicidade.
        {!cfg.data?.paywall && ' Durante o beta, todo o conteúdo está liberado.'}
      </PageTitle>
      {plans.data?.sandbox && <p className="border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm text-warning"><strong>Ambiente de teste (sandbox).</strong> Nenhuma cobrança real é feita e nenhum dado de cartão é solicitado.</p>}
      {me.data && sub.data && (
        <section className="rule-top py-4">
          <h2 className="kicker m-0">Sua situação</h2>
          <p className="m-0 mt-1 font-serif text-xl font-bold">{statusLabel[sub.data.status]}{sub.data.plan ? ` · ${sub.data.plan.name}` : ''}</p>
          {sub.data.currentPeriodEnd && <p className="m-0 text-sm text-muted">{sub.data.cancelAtPeriodEnd ? 'Acesso até' : 'Próxima renovação'}: {fmtDate(sub.data.currentPeriodEnd)}{sub.data.cancelAtPeriodEnd ? ' (sem renovação)' : ''}</p>}
          {['active', 'trialing', 'past_due'].includes(sub.data.status) && !sub.data.cancelAtPeriodEnd && (
            <button type="button" className="btn btn-ghost mt-3" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancelar renovação</button>
          )}
        </section>
      )}
      {plans.isLoading && <Loading />}
      {plans.error && <ErrorState error={plans.error} />}
      <div className="grid gap-6 py-4 sm:grid-cols-2">
        {plans.data?.items.map((p) => (
          <section key={p.id} className="border-t-2 border-ink pt-3">
            <h2 className="m-0 font-serif text-2xl font-bold">{p.name}</h2>
            <p className="tnum m-0 mt-1 text-3xl font-bold">{fmtBRL(p.priceCents)}<span className="text-base font-normal text-muted">/mês</span></p>
            <p className="text-sm text-muted">{p.description}</p>
            {me.data?.isGuest ? (
              <Link to="/entrar" className="btn btn-primary">Informar e-mail para assinar</Link>
            ) : me.data ? (
              <button type="button" className="btn btn-primary" disabled={checkout.isPending || ['active', 'trialing'].includes(sub.data?.status ?? '')} onClick={() => checkout.mutate(p.id)}>Assinar</button>
            ) : (
              <Link to="/entrar" className="btn btn-primary">Entrar para assinar</Link>
            )}
          </section>
        ))}
      </div>
      {checkout.error && <p role="alert" className="text-danger">{(checkout.error as ApiError).message}</p>}
      <p className="text-xs text-muted">Valores em avaliação (hipótese comercial do beta). Cancelamento a qualquer momento, sem renovação silenciosa. Não armazenamos dados de cartão.</p>
    </div>
  );
}

export function SandboxCheckout() {
  const [sp] = useSearchParams();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const sub = sp.get('sub') ?? '';
  const m = useMutation({
    mutationFn: (outcome: 'approved' | 'failed') => api<SubscriptionDto>('/billing/sandbox/complete', { method: 'POST', body: { subscription: sub, outcome } }),
    onSuccess: async () => { await qc.invalidateQueries(); nav('/assinatura'); },
  });
  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/entrar" replace />;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-10">
      <p className="m-0 border-2 border-dashed border-warning p-3 text-sm font-semibold text-warning">CHECKOUT DE TESTE — nenhuma cobrança real. Simula a resposta do provedor de pagamento, que chega ao servidor por webhook assinado.</p>
      <h1 className="m-0 font-serif text-3xl font-bold">Confirmar assinatura (sandbox)</h1>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => m.mutate('approved')} disabled={m.isPending}>Simular pagamento aprovado</button>
        <button type="button" className="btn btn-ghost" onClick={() => m.mutate('failed')} disabled={m.isPending}>Simular falha</button>
      </div>
      {m.error && <p role="alert" className="text-danger">{(m.error as ApiError).message}</p>}
    </div>
  );
}
