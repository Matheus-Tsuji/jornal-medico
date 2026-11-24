import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { EditionDto, Source } from '@jm/contracts';
import { api, useConfig, useMe } from '../lib/api';
import { DISCLAIMER, IndiLogo } from '../components/Brand';
import { useReadingPrefs } from '../lib/prefs';
import { Monitor, Moon, Sun } from 'lucide-react';

const PLANS = [
  { name: 'Grátis', price: 'Grátis', cta: 'Criar conta', featured: false, items: ['Edição do dia com leitura rápida', 'Nota de evidência A1–C3 de cada estudo', 'Salvar estudos'] },
  { name: 'Básico', price: 'R$ 29,90', cta: 'Assinar o Básico', featured: false, items: ['Tudo do Grátis', 'Análise completa: métodos, resultados e limitações', 'Todas as áreas e especialidades'] },
  { name: 'Pro', price: 'R$ 49,90', cta: 'Assinar o Pro', featured: true, items: ['Tudo do Básico', 'Pergunta do estudo em PICO/PECO', 'Recursos de assinante que entrarem primeiro'] },
];

const faq: [string, string][] = [
  ['Isto substitui ler o artigo original?', 'Não. O jornal resume e organiza; cada estudo tem link para a fonte original, e a análise mostra de onde saiu cada número.'],
  ['Quem escreve os resumos?', 'Uma IA extrai os dados do material de origem e redige o resumo; um editor humano confere números e texto antes de publicar. Itens de demonstração são marcados como fictícios.'],
  ['Como crio minha conta?', 'Com e-mail e senha, em menos de um minuto. Não pedimos CRM nem dados clínicos.'],
  ['Vou receber o jornal por e-mail?', 'Não. O jornal fica na plataforma; os e-mails são apenas de acesso, conta e pagamento.'],
  ['O periódico ser de prestígio garante a qualidade?', 'Não. Mostramos dados do veículo separadamente da avaliação do estudo, e nenhum dos dois decide sozinho a relevância.'],
  ['Quais áreas estão disponíveis?', 'Clínica médica, cirurgia geral, pediatria, ginecologia e obstetrícia, medicina preventiva e social, e odontologia com as especialidades reconhecidas pelo CFO.'],
];

export default function Landing() {
  const cfg = useConfig();
  const me = useMe();
  const ed = useQuery({ queryKey: ['edition', 'latest', 'landing'], queryFn: () => api<{ edition: EditionDto | null }>('/editions/latest') });
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<Source[]>('/sources') });
  const brand = cfg.data?.brandName ?? 'Index Discovery';
  const prefs = useReadingPrefs();
  useEffect(() => { document.title = `${brand} — atualização científica diária`; }, [brand]);
  const e = ed.data?.edition;
  const today = e?.todayCount ?? null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="no-underline" aria-label={brand}><IndiLogo height={44} /></Link>
          <nav className="flex items-center gap-2" aria-label="Principal">
            <button type="button" onClick={prefs.cycleTheme} className="btn btn-ghost !min-h-9 !px-2.5" aria-label={`Tema: ${{ system: 'automático', light: 'claro', dark: 'escuro' }[prefs.theme]}. Clique para trocar`}>
              {prefs.theme === 'light' ? <Sun size={16} aria-hidden /> : prefs.theme === 'dark' ? <Moon size={16} aria-hidden /> : <Monitor size={16} aria-hidden />}
            </button>
            <a href="#como" className="hidden px-2 text-sm hover:underline sm:inline">Como funciona</a>
            <a href="#assinatura" className="hidden px-2 text-sm hover:underline sm:inline">Assinatura</a>
            {me.data ? <Link to="/jornal" className="btn btn-primary">Abrir o jornal</Link> : <Link to="/entrar" className="btn btn-primary">Entrar</Link>}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[1.15fr_1fr] lg:py-20">
          <div className="grid content-start gap-5">
            
            <p className="kicker m-0 text-primary">Index Discovery · ciência médica e odontológica</p>
            <h1 className="m-0 font-serif text-[2.6rem] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
              Os estudos que importam, lidos para você antes do plantão.
            </h1>
            <p className="m-0 max-w-[52ch] font-serif text-xl leading-relaxed text-ink/85">
              Toda manhã, uma edição curta com publicações selecionadas de fontes como o PubMed: resumo em português, números com intervalo de confiança, limitações e o link original.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={me.data ? '/jornal' : '/entrar'} className="btn btn-primary">{me.data ? 'Abrir a edição de hoje' : 'Criar conta grátis'}</Link>
              <Link to="/jornal" className="btn btn-ghost">Ler sem criar conta</Link>
            </div>
            <p className="m-0 text-sm text-muted">Para médicos, residentes e estudantes. Sem anúncios, sem feed infinito, sem rede social.</p>
            <p className="m-0 max-w-[60ch] border-l-2 border-line pl-3 text-xs leading-relaxed text-muted">{DISCLAIMER}</p>
          </div>

          {/* Sem prévias: o lado direito explica o método com números reais do dia (pedido do Matheus, 2026-11-24). */}
          <aside aria-labelledby="metodo-hero" className="hero-method">
            <p id="metodo-hero" className="kicker m-0 text-primary">Do estudo à nota</p>
            <ol className="hero-steps">
              {[
                ['Busca', '3 bases científicas lidas todo dia', 'PubMed, Europe PMC e SciELO, por área e especialidade.'],
                ['Triagem', 'Regras fixas, sem palpite', 'Desenho do estudo, idioma, retratação e resumo disponível.'],
                ['Análise', 'Números como foram publicados', 'Medida de efeito, intervalo de confiança e p-valor; o ausente aparece como ausente.'],
                ['Nota', 'Força da evidência de A1 a C3', 'A letra vem do desenho; o número cai com incerteza.'],
              ].map(([t, h, d], i) => (
                <li key={t}>
                  <span className="hero-step-n tnum" aria-hidden>{i + 1}</span>
                  <div className="grid gap-0.5">
                    <p className="m-0 text-xs font-bold tracking-wider text-muted uppercase">{t}</p>
                    <p className="m-0 font-serif text-lg font-semibold leading-snug">{h}</p>
                    <p className="m-0 text-sm text-muted">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="grid gap-2">
              <p className="m-0 text-xs font-bold tracking-wider text-muted uppercase">Escala da nota</p>
              <div className="grade-scale-bar" role="img" aria-label="Escala de A1, evidência mais forte, até C3, mais fraca">
                {['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'].map((g) => <span key={g} data-tier={g[0]}>{g}</span>)}
              </div>
              <p className="m-0 flex justify-between text-xs text-muted"><span>mais forte</span><span>mais fraca</span></p>
            </div>
            {today !== null && (
              <p className="tnum m-0 border-t border-line pt-3 text-sm"><strong className="font-serif text-2xl font-bold text-primary">{today}</strong> estudos analisados hoje</p>
            )}
          </aside>
        </section>

        <section id="como" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
            {[
              ['Organiza a sua leitura', 'Reunimos publicações recentes de bases científicas em uma edição por área, com começo e fim. A leitura da fonte original continua indispensável.'],
              ['Números como publicados', 'Medida de efeito, intervalo de confiança e p-valor aparecem como os autores reportaram. O que não foi reportado fica indicado como ausente; não recalculamos resultados.'],
              ['Informa, não orienta', 'Conteúdo científico e educacional. Não é orientação diagnóstica ou terapêutica e não substitui o julgamento clínico do profissional de saúde.'],
            ].map(([t, d]) => (
              <div key={t} className="border-t-2 border-ink pt-3">
                <h2 className="m-0 font-serif text-2xl font-bold">{t}</h2>
                <p className="mt-2 text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
          <div>
            <h2 className="m-0 font-serif text-3xl font-bold">Metodologia</h2>
            <ol className="mt-4 grid gap-3 pl-5">
              <li>Busca programática em fontes autorizadas (não pedimos a uma IA que “lembre” estudos).</li>
              <li>Triagem por regras explícitas: tipo de publicação, idioma, retratação, existência de resumo.</li>
              <li>Extração estruturada com IA, só a partir do material de origem, e validação automática dos números.</li>
              <li>Revisão por editor humano antes de publicar. Correções e retratações ficam visíveis.</li>
            </ol>
            <Link to="/metodologia" className="link mt-2 inline-block">Ler a metodologia completa</Link>
          </div>
          <div>
            <h2 className="m-0 font-serif text-3xl font-bold">Fontes</h2>
            <ul className="mt-4 grid gap-2 p-0">
              {(sources.data ?? []).map((s) => (
                <li key={s.slug} className="flex list-none items-baseline justify-between gap-3 border-b border-line pb-2">
                  <span>{s.name}</span>
                  <span className={`chip ${s.enabled ? 'chip-ok' : ''}`}>{s.enabled ? 'integrada' : 'planejada'}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="assinatura" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <h2 className="m-0 font-serif text-3xl font-bold">Planos</h2>
            <p className="max-w-prose text-muted">Sem anúncios: o Index Discovery é mantido por quem lê. Cancele quando quiser.</p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {PLANS.map((p) => (
                <div key={p.name} className={`plan-card ${p.featured ? 'plan-card-featured' : ''}`}>
                  {p.featured && <span className="chip chip-ok w-fit">Mais completo</span>}
                  <p className="kicker m-0 text-muted">{p.name}</p>
                  <p className="tnum m-0 font-serif text-4xl font-bold">{p.price}{p.price !== 'Grátis' && <span className="font-sans text-base font-normal text-muted">/mês</span>}</p>
                  <ul className="m-0 grid gap-1.5 pl-5 text-sm">{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
                  <Link to={me.data ? '/assinatura' : '/entrar'} className={`btn mt-auto ${p.featured ? 'btn-primary' : 'btn-ghost'}`}>{p.cta}</Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12" aria-labelledby="faq">
          <h2 id="faq" className="m-0 font-serif text-3xl font-bold">Perguntas frequentes</h2>
          <div className="mt-4">
            {faq.map(([q, a]) => (
              <details key={q} className="border-b border-line py-3">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{q}</summary>
                <p className="m-0 mt-1 text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-ink">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted">
          {DISCLAIMER} <Link to="/privacidade" className="link">Privacidade e termos</Link>
        </p>
      </footer>
    </div>
  );
}
