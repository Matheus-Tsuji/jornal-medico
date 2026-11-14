import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requestCodeInput, verifyCodeInput } from '@jm/contracts';
import { api, ApiError, useConfig, useMe } from '../lib/api';

export default function Entrar() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const nav = useNavigate();
  const qc = useQueryClient();
  const cfg = useConfig();
  const me = useMe();

  // Visitante pode vir aqui para informar o e-mail; conta identificada é redirecionada.
  useEffect(() => {
    if (me.data && !me.data.isGuest) nav(me.data.onboarded ? '/jornal' : '/boas-vindas', { replace: true });
  }, [me.data, nav]);
  // Modo de teste: sem provedor de e-mail, o código aparece aqui (nunca em produção).
  const devCode = useQuery({
    queryKey: ['dev-code', email],
    enabled: step === 'code' && !!cfg.data?.devOutbox,
    refetchInterval: 2000,
    queryFn: async () => {
      const r = await api<{ items: { body: string }[] }>(`/dev/outbox?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      return r.items[0]?.body.match(/\d{6}/)?.[0] ?? null;
    },
  });
  const guest = useMutation({
    mutationFn: () => api<{ onboarded: boolean }>('/auth/guest', { method: 'POST' }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      nav(r.onboarded ? '/jornal' : '/boas-vindas', { replace: true });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar agora.'),
  });
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = useMutation({
    mutationFn: () => api<{ message: string }>('/auth/request-code', { method: 'POST', body: requestCodeInput.parse({ email }) }),
    onSuccess: () => { setStep('code'); setErr(''); setCooldown(30); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Informe um e-mail válido.'),
  });
  const verify = useMutation({
    mutationFn: () => api<{ onboarded: boolean }>('/auth/verify-code', { method: 'POST', body: verifyCodeInput.parse({ email, code }) }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      nav(r.onboarded ? '/jornal' : '/boas-vindas', { replace: true });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'O código tem 6 dígitos.'),
  });

  return (
    <div className="mx-auto grid max-w-md gap-6 px-4 py-10">
      <header className="rule-strong pt-4">
        <h1 className="m-0 font-serif text-3xl font-bold">Entrar</h1>
        <p className="mt-2 text-muted">Sem senha: enviamos um código de 6 dígitos para o seu e-mail. Não pedimos CRM nem dados clínicos.</p>
      </header>
      {step === 'email' ? (
        <form onSubmit={(e) => { e.preventDefault(); request.mutate(); }} className="grid gap-3" noValidate>
          <label htmlFor="email" className="text-sm font-semibold">E-mail</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={!!err} aria-describedby={err ? 'err' : undefined} />
          {err && <p id="err" role="alert" className="m-0 text-sm text-danger">{err}</p>}
          <button className="btn btn-primary" disabled={request.isPending || !email}>{request.isPending ? 'Enviando…' : 'Receber código'}</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); verify.mutate(); }} className="grid gap-3" noValidate>
          <p role="status" className="m-0 text-sm">Se o endereço <strong>{email}</strong> for válido, o código chega em instantes. Ele vale por 10 minutos.</p>
          <label htmlFor="code" className="text-sm font-semibold">Código</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className="input tnum text-center text-2xl tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!err} aria-describedby={err ? 'err' : undefined} autoFocus />
          {err && <p id="err" role="alert" className="m-0 text-sm text-danger">{err}</p>}
          <button className="btn btn-primary" disabled={verify.isPending || code.length !== 6}>{verify.isPending ? 'Verificando…' : 'Entrar'}</button>
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" className="btn btn-ghost" disabled={cooldown > 0 || request.isPending} onClick={() => request.mutate()}>
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setStep('email'); setCode(''); setErr(''); }}>Trocar e-mail</button>
          </div>
          {cfg.data?.devOutbox && (
            <div role="status" className="grid gap-2 border-2 border-dashed border-warning bg-warning-soft p-3 text-sm text-warning">
              <p className="m-0"><strong>Modo de teste:</strong> nenhum e-mail real é enviado ainda. {devCode.data ? <>Seu código é <strong className="tnum text-base tracking-widest" data-testid="dev-code">{devCode.data}</strong>.</> : 'Buscando o código…'}</p>
              {devCode.data && <button type="button" className="btn btn-ghost w-fit !min-h-9" onClick={() => setCode(devCode.data!)}>Usar este código</button>}
              <Link to={`/dev/caixa?email=${encodeURIComponent(email)}`} className="link text-xs" target="_blank">Abrir a caixa postal local</Link>
            </div>
          )}
        </form>
      )}
      {step === 'email' && !me.data?.isGuest && (
        <div className="rule-top grid gap-2 pt-4">
          <button type="button" className="btn btn-ghost" onClick={() => guest.mutate()} disabled={guest.isPending}>{guest.isPending ? 'Entrando…' : 'Continuar sem e-mail'}</button>
          <p className="m-0 text-xs text-muted">Você lê, escolhe interesses e salva estudos como visitante, só neste navegador. Para não perder nada, informe o e-mail depois em “Minha conta”.</p>
        </div>
      )}
      {me.data?.isGuest && <p className="m-0 text-sm">Você está como visitante. Ao confirmar o e-mail, seus interesses e salvos continuam na conta.</p>}
      <p className="m-0 text-xs text-muted">Os e-mails que enviamos são apenas transacionais (acesso, conta e pagamento). O jornal fica aqui na plataforma.</p>
    </div>
  );
}
