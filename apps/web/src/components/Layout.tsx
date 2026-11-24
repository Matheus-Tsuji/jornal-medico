import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Monitor, Moon, Search, Sun, UserRound } from 'lucide-react';
import { DISCLAIMER, IndiLogo, IndiMark } from './Brand';
import { useConfig, useMe, useTopics } from '../lib/api';
import ScrollRow from './ScrollRow';
import { useReadingPrefs } from '../lib/prefs';

export type LayoutCtx = ReturnType<typeof useReadingPrefs>;


// Cartão do leitor no cabeçalho: avatar, nome, atalhos (Salvos, Histórico) e Entrar ou menu da conta.
function ReaderCard() {
  const me = useMe();
  if (me.isLoading) return <span className="h-14 w-72" aria-hidden />;
  const u = me.data;
  const guest = !u || u.isGuest;
  const name = !u || u.isGuest ? 'Visitante' : u.displayName ?? u.email.split('@')[0]!;
  return (
    <div className="reader-card">
      <span className="reader-avatar" aria-hidden>{name[0]!.toUpperCase()}</span>
      <div className="grid gap-0.5">
        <Link to="/perfil" className="text-sm font-semibold text-ink no-underline hover:underline">{name}</Link>
        {guest
          ? <Link to="/entrar" className="link text-[13px]">Entre para personalizar sua capa</Link>
          : <Link to="/configuracoes" className="link text-[13px]">Preferências da capa</Link>}
      </div>
      {/* Perfil: abre a tela de perfil, onde ficam Salvos, Histórico, Preferências, Assinatura e Sair. */}
      <Link to="/perfil" className="btn btn-ghost !min-h-11"><UserRound size={16} aria-hidden /> Perfil</Link>
    </div>
  );
}

const themeLabel = { system: 'Automático', light: 'Claro', dark: 'Escuro' } as const;

// O cabeçalho NÃO muda de altura com a rolagem: no Safari (iOS e macOS), encolher o header pela posição do scroll
// mudava a altura da página, que mudava o scroll, que desfazia o encolhimento (flicker). Agora o logo grande rola
// normalmente e só a barra de seções fica presa no topo.
function Masthead({ prefs }: { prefs: LayoutCtx }) {
  return (
    <>
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 pt-7 pb-6">
        {/* Encolhe com a rolagem só por transform (CSS, sem JS): a altura não muda, então o Safari não pisca. */}
        <Link to="/jornal" className="masthead-logo no-underline" aria-label="Indi — Index Discovery, edição de hoje"><IndiLogo /></Link>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-1.5">
            {/* Busca: só o lugar no layout por enquanto (pedido do Matheus, 2026-11-16). */}
            <button type="button" className="btn btn-ghost !min-h-11 !px-3" aria-label="Pesquisar (em breve)" title="Pesquisa em breve" aria-disabled="true"><Search size={18} aria-hidden /></button>
            <button type="button" onClick={prefs.cycleScale} className="btn btn-ghost !min-h-11 !px-3.5" aria-label={`Tamanho do texto: ${Math.round(Number(prefs.scale) * 100)}%`}>Aa</button>
            <button type="button" onClick={prefs.cycleTheme} className="btn btn-ghost !min-h-11 !px-3.5 font-medium" aria-label={`Tema: ${themeLabel[prefs.theme]}. Clique para trocar`} title={`Tema: ${themeLabel[prefs.theme]}`}>
              {prefs.theme === 'light' ? <Sun size={16} aria-hidden /> : prefs.theme === 'dark' ? <Moon size={16} aria-hidden /> : <Monitor size={16} aria-hidden />}
              {themeLabel[prefs.theme]}
            </button>
          </div>
          <ReaderCard />
        </div>
      </div>
    </header>
    <div className="sticky top-0 z-20 border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl items-center">
        <Link to="/jornal" className="nav-seal shrink-0 pl-3" aria-label="Indi — edição de hoje" tabIndex={-1}><IndiMark height={30} /></Link>
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
        <NavLink to="/congressos" className={cls}>Congressos</NavLink>
        {areas.map((a) => (
          <NavLink key={a.slug} to={`/areas/${a.slug}`} className={cls}>
            {a.label}
            {!a.enabled && <span className="ml-1.5 text-[0.65rem] text-muted">em preparação</span>}
          </NavLink>
        ))}
        {/* Áreas médicas, regulação, publicações e Congressos (no lugar de Edições e Mais lidos, pedido do Matheus, 2026-11-18). */}
        <NavLink to="/regulacao" className={cls}>Saúde pública e regulação</NavLink>
        <NavLink to="/publicacoes" className={cls}>Publicações científicas</NavLink>
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
          <IndiLogo height={56} />
          <p className="mt-2">{DISCLAIMER}</p>
        </div>
        <nav aria-label="Rodapé" className="grid content-start gap-1.5">
          <Link to="/metodologia" className="link">Metodologia e fontes</Link>
          <Link to="/congressos" className="link">Congressos</Link>
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
      {/* Faixa fina acima do cabeçalho; a edição de hoje (Jornal) preenche via portal. */}
      <div id="edition-strip" className="border-b border-line empty:hidden" />
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
