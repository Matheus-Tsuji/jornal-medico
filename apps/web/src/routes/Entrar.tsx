import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passwordAuthInput, passwordRegisterInput, requestCodeInput, verifyCodeInput } from '@jm/contracts';
import { Eye, EyeOff } from 'lucide-react';
import { api, ApiError, useConfig, useMe } from '../lib/api';

type Mode = 'login' | 'register' | 'code';

export default function Entrar() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [codeStep, setCodeStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [guestErr, setGuestErr] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const nav = useNavigate();
  const qc = useQueryClient();
  const cfg = useConfig();
  const me = useMe();

  // Visitante pode vir aqui para criar a conta; conta identificada é redirecionada.
  useEffect(() => {
    if (me.data && !me.data.isGuest) nav(me.data.onboarded ? '/jornal' : '/boas-vindas', { replace: true });
  }, [me.data, nav]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const done = async (r: { onboarded: boolean }) => {
    await qc.invalidateQueries();
    nav(r.onboarded ? '/jornal' : '/boas-vindas', { replace: true });
  };
  const failMsg = (e: unknown, fallback: string) => setErr(e instanceof ApiError ? e.message : fallback);

  const pw = useMutation({
    mutationFn: () => {
      const parsed = mode === 'register' ? passwordRegisterInput.safeParse({ email, password, displayName }) : passwordAuthInput.safeParse({ email, password });
      if (!parsed.success) throw new ApiError(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Confira o e-mail e a senha.');
      if (mode === 'register' && password !== password2) throw new ApiError(400, 'validation_error', 'As senhas não conferem.');
      return api<{ onboarded: boolean }>(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: parsed.data });
    },
    onSuccess: done,
    onError: (e) => {
      // Sem banco permanente (vitrine), contas criadas antes de uma atualização do site deixam de existir.
      if (e instanceof ApiError && e.code === 'invalid_credentials' && cfg.data?.ephemeral) {
        setErr('E-mail ou senha incorretos. Nesta versão de testes, contas criadas antes de uma atualização do site são apagadas: se for o seu caso, crie a conta de novo.');
      } else failMsg(e, 'Não foi possível continuar. Tente de novo.');
    },
  });

  // Código por e-mail: só aparece quando há provedor de e-mail configurado.
  const devCode = useQuery({
    queryKey: ['dev-code', email],
    enabled: mode === 'code' && codeStep === 'code' && !!cfg.data?.devOutbox,
    refetchInterval: 2000,
    queryFn: async () => {
      const r = await api<{ items: { body: string }[] }>(`/dev/outbox?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      return r.items[0]?.body.match(/\d{6}/)?.[0] ?? null;
    },
  });
  const request = useMutation({
    mutationFn: () => api<{ message: string }>('/auth/request-code', { method: 'POST', body: requestCodeInput.parse({ email }) }),
    onSuccess: () => { setCodeStep('code'); setErr(''); setCooldown(30); },
    onError: (e) => failMsg(e, 'Informe um e-mail válido.'),
  });
  const verify = useMutation({
    mutationFn: () => api<{ onboarded: boolean }>('/auth/verify-code', { method: 'POST', body: verifyCodeInput.parse({ email, code }) }),
    onSuccess: done,
    onError: (e) => failMsg(e, 'O código tem 6 dígitos.'),
  });
  const guest = useMutation({
    mutationFn: () => api<{ onboarded: boolean }>('/auth/guest', { method: 'POST' }),
    onSuccess: done,
    onError: (e) => setGuestErr(e instanceof ApiError ? e.message : 'Não foi possível entrar agora. Tente de novo em instantes.'),
  });

  const switchMode = (m: Mode) => { setMode(m); setErr(''); setCodeStep('email'); };
  const register = mode === 'register';

  return (
    <div className="mx-auto grid max-w-md gap-6 px-4 py-10">
      <header className="rule-strong pt-4">
        <h1 className="m-0 font-serif text-3xl font-bold">{register ? 'Criar conta' : 'Entrar'}</h1>
        <p className="mt-2 text-muted">{register ? 'Leva menos de um minuto. Não pedimos CRM nem dados clínicos.' : 'Entre com seu e-mail e senha para ver sua capa personalizada.'}</p>
      </header>

      {cfg.data?.ephemeral && (
        <p role="status" className="m-0 border-l-4 border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          Versão de testes: contas criadas agora podem ser apagadas quando o servidor reiniciar. O banco permanente entra em breve.
        </p>
      )}
      <div role="tablist" aria-label="Acesso" className="auth-tabs">
        <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>Entrar</button>
        <button type="button" role="tab" aria-selected={register} onClick={() => switchMode('register')}>Criar conta</button>
      </div>

      {mode !== 'code' ? (
        <form onSubmit={(e) => { e.preventDefault(); setErr(''); pw.mutate(); }} className="grid gap-3" noValidate>
          {register && (
            <>
              <label htmlFor="display-name" className="text-sm font-semibold">Nome de exibição</label>
              <input id="display-name" type="text" autoComplete="name" className="input" placeholder="Ex.: Dra. Ana Souza" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} />
            </>
          )}
          <label htmlFor="email" className="text-sm font-semibold">E-mail</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={!!err} aria-describedby={err ? 'err' : undefined} />
          <label htmlFor="password" className="text-sm font-semibold">Senha</label>
          <div className="relative">
            <input id="password" type={showPw ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} className="input !pr-12" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} aria-describedby={register ? 'pw-hint' : undefined} />
            <button type="button" className="absolute top-0 right-0 grid h-11 w-11 place-items-center text-muted" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Esconder senha' : 'Mostrar senha'}>
              {showPw ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
          {register && <p id="pw-hint" className="m-0 -mt-1 text-xs text-muted">Pelo menos 8 caracteres.</p>}
          {register && (
            <>
              <label htmlFor="password2" className="text-sm font-semibold">Repita a senha</label>
              <input id="password2" type={showPw ? 'text' : 'password'} autoComplete="new-password" className="input" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
            </>
          )}
          {err && <p id="err" role="alert" className="m-0 text-sm text-danger">{err}</p>}
          <button className="btn btn-primary" disabled={pw.isPending || !email || !password || (register && !displayName.trim())}>
            {pw.isPending ? (register ? 'Criando conta…' : 'Entrando…') : register ? 'Criar conta' : 'Entrar'}
          </button>
          <p className="m-0 text-sm text-muted">
            {register ? <>Já tem conta? <button type="button" className="link" onClick={() => switchMode('login')}>Entrar</button></> : <>Ainda não tem conta? <button type="button" className="link" onClick={() => switchMode('register')}>Criar conta</button></>}
          </p>
          {cfg.data?.emailLogin && !register && <button type="button" className="link w-fit text-sm" onClick={() => switchMode('code')}>Entrar com código por e-mail</button>}
        </form>
      ) : codeStep === 'email' ? (
        <form onSubmit={(e) => { e.preventDefault(); request.mutate(); }} className="grid gap-3" noValidate>
          <label htmlFor="email" className="text-sm font-semibold">E-mail</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={!!err} aria-describedby={err ? 'err' : undefined} />
          {err && <p id="err" role="alert" className="m-0 text-sm text-danger">{err}</p>}
          <button className="btn btn-primary" disabled={request.isPending || !email}>{request.isPending ? 'Enviando…' : 'Receber código'}</button>
          <button type="button" className="link w-fit text-sm" onClick={() => switchMode('login')}>Voltar para e-mail e senha</button>
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
            <button type="button" className="btn btn-ghost" onClick={() => { setCodeStep('email'); setCode(''); setErr(''); }}>Trocar e-mail</button>
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

      {me.data?.isGuest ? (
        <p className="m-0 text-sm">Você está como visitante. Ao criar a conta, seus interesses e salvos continuam nela.</p>
      ) : (
        <div className="rule-top grid gap-2 pt-4">
          <button type="button" className="btn btn-ghost" onClick={() => { setGuestErr(''); guest.mutate(); }} disabled={guest.isPending}>{guest.isPending ? 'Entrando…' : 'Continuar sem conta'}</button>
          {guestErr && <p role="alert" className="m-0 text-sm text-danger">{guestErr}</p>}
          <p className="m-0 text-xs text-muted">Como visitante você lê e salva estudos só neste navegador. Crie a conta depois para não perder nada.</p>
        </div>
      )}
    </div>
  );
}
