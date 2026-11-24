// Perfil do leitor: quem é, plano, interesses, acervo (salvos e histórico), aparência e conta.
import { Link, useNavigate, useOutletContext } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronRight, Clock, CreditCard, LogOut, Mail, Monitor, Moon, SlidersHorizontal, Sun, Type } from 'lucide-react';
import type { ArticleCard } from '@jm/contracts';
import { api, useMe, useTopics } from '../lib/api';
import { ListRow } from '../components/ArticleCard';
import { Loading } from '../components/ui';
import type { LayoutCtx } from '../components/Layout';

const themeLabel = { system: 'Automático', light: 'Claro', dark: 'Escuro' } as const;

function Row({ to, icon, title, hint }: { to: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Link to={to} className="profile-row">
      <span className="profile-row-icon" aria-hidden>{icon}</span>
      <span className="grid"><span className="font-semibold">{title}</span><span className="text-xs text-muted">{hint}</span></span>
      <ChevronRight size={16} className="ml-auto text-muted" aria-hidden />
    </Link>
  );
}

export default function Perfil() {
  const me = useMe();
  const prefs = useOutletContext<LayoutCtx>();
  const topics = useTopics();
  const qc = useQueryClient();
  const nav = useNavigate();
  const saved = useQuery({ queryKey: ['/bookmarks', me.data?.id], enabled: !!me.data, queryFn: () => api<{ items: ArticleCard[] }>('/bookmarks') });
  const history = useQuery({ queryKey: ['/history', me.data?.id], enabled: !!me.data, queryFn: () => api<{ items: ArticleCard[] }>('/history') });

  if (me.isLoading) return <div className="mx-auto max-w-4xl px-4"><Loading /></div>;
  // Sem sessão: mostra o perfil de visitante (tudo vazio), em vez de mandar para o login.
  const u = me.data ?? { id: 'visitante', email: '', isGuest: true, role: 'reader' as const, entitled: false, preferences: { topics: [] as string[], sources: [] as string[] } };
  const hasSession = !!me.data;
  const name = u.isGuest ? 'Visitante' : ('displayName' in u && u.displayName) || u.email.split('@')[0]!;
  const role = u.role === 'admin' ? 'Administrador' : u.role === 'editor' ? 'Editor' : u.isGuest ? 'Visitante' : 'Leitor';
  const interests = (topics.data ?? []).filter((t) => u.preferences.topics.includes(t.slug));
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); qc.clear(); nav('/'); };


  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-8">
      {/* Identidade */}
      <section className="profile-hero" aria-label="Seu perfil">
        <span className="profile-avatar" aria-hidden>{name[0]!.toUpperCase()}</span>
        <div className="grid gap-1">
          <h1 className="m-0 font-serif text-3xl font-bold">{name}</h1>
          <p className="m-0 text-sm text-muted">{u.isGuest ? 'Sessão de visitante, sem e-mail' : u.email}</p>
          <p className="m-0 flex flex-wrap gap-1.5 pt-1">
            <span className="chip">{role}</span>
            <span className={`chip ${u.entitled ? 'chip-ok' : ''}`}>{u.entitled ? 'Assinante' : 'Plano gratuito'}</span>
          </p>
        </div>
        <dl className="profile-stats tnum">
          <div><dt>Salvos</dt><dd>{saved.data?.items.length ?? '—'}</dd></div>
          <div><dt>Lidos</dt><dd>{history.data?.items.length ?? '—'}</dd></div>
          <div><dt>Interesses</dt><dd>{interests.length}</dd></div>
        </dl>
      </section>

      {u.isGuest && (
        <section className="profile-callout" aria-label="Guardar sua conta">
          <Mail size={20} aria-hidden className="text-primary" />
          <p className="m-0 flex-1 text-sm">Você está como visitante: o que salvar fica só neste navegador. Use seu e-mail para guardar salvos e interesses em qualquer aparelho.</p>
          <Link to="/entrar" className="btn btn-primary">Guardar com meu e-mail</Link>
        </section>
      )}

      {/* Interesses */}
      <section aria-labelledby="interesses">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="interesses" className="kicker m-0 text-ink">Seus interesses</h2>
          <Link to="/configuracoes" className="link text-sm">Editar</Link>
        </div>
        {interests.length
          ? <p className="m-0 flex flex-wrap gap-2">{interests.map((t) => <Link key={t.slug} to={`/temas/${t.slug}`} className="chip !text-sm !py-1 !px-3 no-underline">{t.label}</Link>)}</p>
          : <p className="m-0 text-sm text-muted">Nenhum tema escolhido. <Link to="/configuracoes" className="link">Escolha temas</Link> para personalizar sua capa.</p>}
      </section>

      {/* Acervo e conta */}
      <section aria-labelledby="atalhos" className="grid gap-2 sm:grid-cols-2">
        <h2 id="atalhos" className="sr-only">Atalhos</h2>
        <Row to="/salvos" icon={<Bookmark size={18} />} title="Salvos" hint={`${saved.data?.items.length ?? 0} estudos guardados`} />
        <Row to="/historico" icon={<Clock size={18} />} title="Histórico" hint={`${history.data?.items.length ?? 0} leituras`} />
        <Row to="/configuracoes" icon={<SlidersHorizontal size={18} />} title="Preferências" hint="Temas, fontes e personalização" />
        <Row to="/assinatura" icon={<CreditCard size={18} />} title="Assinatura" hint={u.entitled ? 'Plano ativo' : 'Conheça o plano'} />
      </section>

      {/* Aparência */}
      <section aria-labelledby="aparencia" className="grid gap-3">
        <h2 id="aparencia" className="kicker m-0 text-ink">Aparência</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={prefs.cycleTheme} className="btn btn-ghost">
            {prefs.theme === 'light' ? <Sun size={16} aria-hidden /> : prefs.theme === 'dark' ? <Moon size={16} aria-hidden /> : <Monitor size={16} aria-hidden />} Tema: {themeLabel[prefs.theme]}
          </button>
          <button type="button" onClick={prefs.cycleScale} className="btn btn-ghost"><Type size={16} aria-hidden /> Texto: {Math.round(Number(prefs.scale) * 100)}%</button>
        </div>
      </section>

      {/* Últimos salvos */}
      {(saved.data?.items.length ?? 0) > 0 && (
        <section aria-labelledby="ultimos">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 id="ultimos" className="kicker m-0 text-ink">Salvos recentemente</h2>
            <Link to="/salvos" className="link text-sm">Ver todos</Link>
          </div>
          <ul className="m-0 list-none p-0">{saved.data!.items.slice(0, 3).map((a) => <ListRow key={a.id} a={a} />)}</ul>
        </section>
      )}

      <div className="rule-top flex flex-wrap items-center justify-between gap-3 pt-4">
        {u.role !== 'reader' && <Link to="/admin" className="link text-sm font-semibold">Painel editorial</Link>}
        {hasSession && <button type="button" onClick={logout} className="btn btn-danger ml-auto"><LogOut size={16} aria-hidden /> Sair</button>}
      </div>
    </div>
  );
}
