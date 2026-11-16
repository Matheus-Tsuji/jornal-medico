import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Search, Sun, Type, UserRound } from 'lucide-react';
import { Seal, SealMini, Wordmark } from './Brand';
import { api, fmtLongDate, useConfig, useMe, useTopics } from '../lib/api';
import ScrollRow from './ScrollRow';
import { useReadingPrefs } from '../lib/prefs';

export type LayoutCtx = ReturnType<typeof useReadingPrefs>;

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function AccountMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  if (me.isLoading) return <span className="h-11 w-20" aria-hidden />;
  if (!me.data) return <Link to="/entrar" className="btn btn-ghost !min-h-9 !px-3 text-sm">Entrar</Link>;
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    nav('/');
  };
  return (
    <details className="relative">
      <summary className="btn btn-ghost !min-h-9 list-none !px-3 text-sm" aria-label="Menu da conta">
        <UserRound size={16} aria-hidden /> <span className="hidden sm:inline">{me.data.isGuest ? 'Visitante' : 'Minha conta'}</span>
      </summary>
      <nav aria-label="Conta" className="absolute right-0 z-30 mt-1 grid w-52 border border-line bg-surface py-1 text-sm shadow-sm">
        <p className="truncate px-3 py-2 text-xs text-muted">{me.data.isGuest ? 'Visitante (sem e-mail)' : me.data.email}</p>
        {me.data.isGuest && <Link to="/entrar" className="px-3 py-2 font-semibold text-primary hover:bg-paper">Guardar com meu e-mail</Link>}
        {[['/salvos', 'Salvos'], ['/historico', 'Histórico'], ['/configuracoes', 'Preferências'], ['/assinatura', 'Assinatura']].map(([to, label]) => (
          <Link key={to} to={to!} className="px-3 py-2 hover:bg-paper">{label}</Link>
        ))}
        {me.data.role !== 'reader' && <Link to="/admin" className="px-3 py-2 font-semibold text-accent hover:bg-paper">Painel editorial</Link>}
        <button type="button" onClick={logout} className="px-3 py-2 text-left hover:bg-paper">Sair</button>
      </nav>
    </details>
  );
}

const themeLabel = { system: 'Automático', light: 'Claro', dark: 'Escuro' } as const;

// O cabeçalho NÃO muda de altura com a rolagem: no Safari (iOS e macOS), encolher o header pela posição do scroll
// mudava a altura da página, que mudava o scroll, que desfazia o encolhimento (flicker). Agora o logo grande rola
// normalmente e só a barra de seções fica presa no topo.
function Masthead({ prefs }: { prefs: LayoutCtx }) {
  const cfg = useConfig();
  const brand = cfg.data?.brandName ?? 'Jornal Médico';
  return (
    <>
    <header className="border-b border-line bg-paper">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted">
          <p className="masthead-date m-0 first-letter:uppercase">{fmtLongDate(todayIso())}</p>
          <div className="masthead-tools flex items-center gap-1.5">
            {/* Busca: só o lugar no layout por enquanto (pedido do Matheus, 2026-11-16). */}
            <button type="button" className="btn btn-ghost !min-h-9 !px-2.5 text-xs" aria-label="Pesquisar (em breve)" title="Pesquisa em breve" aria-disabled="true">
              <Search size={14} aria-hidden />
            </button>
            <button type="button" onClick={prefs.cycleScale} className="btn btn-ghost !min-h-9 !px-2.5 text-xs" aria-label={`Tamanho do texto: ${Math.round(Number(prefs.scale) * 100)}%`}>
              <Type size={14} aria-hidden /> Aa
            </button>
            <button type="button" onClick={prefs.cycleTheme} className="btn btn-ghost !min-h-9 !px-2.5 text-xs" aria-label={`Tema: ${themeLabel[prefs.theme]}. Clique para trocar`} title={`Tema: ${themeLabel[prefs.theme]}`}>
              {prefs.theme === 'light' ? <Sun size={14} aria-hidden /> : prefs.theme === 'dark' ? <Moon size={14} aria-hidden /> : <Monitor size={14} aria-hidden />}
              <span className="hidden md:inline">{themeLabel[prefs.theme]}</span>
            </button>
            <AccountMenu />
          </div>
        </div>
        <Link to="/jornal" className="flex items-center justify-center gap-3 no-underline sm:gap-5" aria-label={`${brand} — edição de hoje`}>
          {/* Encolhe com a rolagem só por transform (CSS, sem JS): a altura não muda, então o Safari não pisca. */}
          <span className="masthead-logo flex items-center gap-3 py-2 sm:gap-5 sm:py-3">
            <span className="sm:hidden"><Seal size={56} /></span>
            <span className="hidden sm:block"><Seal size={88} /></span>
            <Wordmark name={brand} size="lg" />
          </span>
        </Link>
      </div>
    </header>
    <div className="sticky top-0 z-20 border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl items-center">
        <Link to="/jornal" className="nav-seal shrink-0 pl-3" aria-label={`${brand} — edição de hoje`} tabIndex={-1}><SealMini size={28} /></Link>
        <div className="min-w-0 flex-1"><AreaNav /></div>
      </div>
    </div>
    </>
  );
}

function AreaNav() {
  const topics = useTopics();
  const areas = (topics.data ?? []).filter((t) => t.level === 'area');
  const cls = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm ${isActive ? 'border-ink font-semibold' : 'border-transparent text-ink/80 hover:border-line'}`;
  return (
    <>
    <nav aria-label="Seções" className="border-t border-line">
      <div className="mx-auto max-w-6xl"><ScrollRow className="flex justify-center-safe px-2" label="seções">
        <NavLink to="/jornal" className={cls} end>Hoje</NavLink>
        {areas.map((a) => (
          <NavLink key={a.slug} to={`/areas/${a.slug}`} className={cls}>
            {a.label}
            {!a.enabled && <span className="ml-1.5 text-[0.65rem] text-muted">em preparação</span>}
          </NavLink>
        ))}
        {/* Áreas médicas primeiro; regulação e publicações logo antes de Edições (pedido do Matheus, 2026-11-16). */}
        <NavLink to="/regulacao" className={cls}>Saúde pública e regulação</NavLink>
        <NavLink to="/publicacoes" className={cls}>Publicações científicas</NavLink>
        <NavLink to="/edicoes" className={cls}>Edições</NavLink>
        <NavLink to="/mais-lidos" className={cls}>Mais lidos</NavLink>
      </ScrollRow></div>
    </nav>
    </>
  );
}

function Footer() {
  const cfg = useConfig();
  return (
    <footer className="mt-16 border-t-2 border-ink">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-muted sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-3"><Seal size={52} /><Wordmark name={cfg.data?.brandName ?? 'Jornal Médico'} size="sm" /></div>
          <p className="mt-2">Conteúdo informativo para profissionais de saúde. Edições publicadas passam por revisão editorial. Prévias automáticas são identificadas e ainda aguardam revisão. Não substitui a leitura da fonte original nem orienta conduta para pacientes.</p>
        </div>
        <nav aria-label="Rodapé" className="grid content-start gap-1.5">
          <Link to="/metodologia" className="link">Metodologia e fontes</Link>
          <Link to="/edicoes" className="link">Edições anteriores</Link>
          <Link to="/assinatura" className="link">Assinatura</Link>
          <Link to="/privacidade" className="link">Privacidade e termos</Link>
        </nav>
        <p className="m-0">Sem anúncios. Edição diária às {cfg.data?.editionHour ?? '06:00'} (horário de Brasília).</p>
      </div>
    </footer>
  );
}

export default function Layout() {
  const prefs = useReadingPrefs();
  const cfg = useConfig();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <Masthead prefs={prefs} />
      {cfg.data && !cfg.data.realContent && !loc.pathname.startsWith('/admin') && (
        <p className="sr-only">Este site está exibindo uma edição de demonstração com estudos fictícios.</p>
      )}
      <main id="conteudo" tabIndex={-1} className="outline-none">
        <div key={loc.pathname} className="page-enter"><Outlet context={prefs} /></div>
      </main>
      <Footer />
    </>
  );
}
