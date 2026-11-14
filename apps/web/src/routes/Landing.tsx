import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { designLabels, type EditionDto, type Plan, type Source } from '@jm/contracts';
import { api, fmtBRL, fmtLongDate, useConfig, useMe } from '../lib/api';
import { KeyResultPanel } from '../components/ui';
import { Seal, SealMini, Wordmark } from '../components/Brand';
import { useReadingPrefs } from '../lib/prefs';
import { Monitor, Moon, Sun } from 'lucide-react';

const faq: [string, string][] = [
  ['Isto substitui ler o artigo original?', 'Não. O jornal resume e organiza; cada estudo tem link para a fonte original, e a análise mostra de onde saiu cada número.'],
  ['Quem escreve os resumos?', 'Uma IA extrai os dados do material de origem e redige o resumo; um editor humano confere números e texto antes de publicar. Itens de demonstração são marcados como fictícios.'],
  ['Preciso de senha?', 'Não. Você entra com o e-mail e recebe um código de 6 dígitos. Não pedimos CRM nem dados clínicos.'],
  ['Vou receber o jornal por e-mail?', 'Não. O jornal fica na plataforma; os e-mails são apenas de acesso, conta e pagamento.'],
  ['O periódico ser de prestígio garante a qualidade?', 'Não. Mostramos dados do veículo separadamente da avaliação do estudo, e nenhum dos dois decide sozinho a relevância.'],
  ['Quais áreas estão disponíveis?', 'O beta começa por clínica médica (hipertensão, diabetes, insuficiência cardíaca). As outras grandes áreas entram quando houver fontes e revisão configuradas.'],
];

export default function Landing() {
  const cfg = useConfig();
  const me = useMe();
  const ed = useQuery({ queryKey: ['edition', 'latest', 'landing'], queryFn: () => api<{ edition: EditionDto | null }>('/editions/latest') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<{ items: Plan[] }>('/billing/plans') });
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<Source[]>('/sources') });
  const brand = cfg.data?.brandName ?? 'Jornal Médico';
  const prefs = useReadingPrefs();
  useEffect(() => { document.title = `${brand} — atualização científica diária`; }, [brand]);
  const e = ed.data?.edition;
  const preview = e ? [e.headline, ...e.secondary].filter(Boolean).slice(0, 3) : [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 no-underline" aria-label={brand}><SealMini size={34} /><Wordmark name={brand} size="sm" tagline={false} /></Link>
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
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <div className="grid content-start gap-5">
            <div className="flex items-center gap-4"><Seal size={72} /><Wordmark name={brand} size="sm" /></div>
            <p className="kicker m-0 text-primary">Jornal diário · baseado em evidências</p>
            <h1 className="m-0 font-serif text-[2.6rem] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
              Os estudos que importam, lidos para você antes do plantão.
            </h1>
            <p className="m-0 max-w-[52ch] font-serif text-xl leading-relaxed text-ink/85">
              Toda manhã, uma edição curta com publicações selecionadas de fontes como o PubMed: resumo em português, números com intervalo de confiança, limitações e o link original.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={me.data ? '/jornal' : '/entrar'} className="btn btn-primary">{me.data ? 'Abrir a edição de hoje' : 'Começar com meu e-mail'}</Link>
              <Link to="/jornal" className="btn btn-ghost">Ler sem criar conta</Link>
            </div>
            <p className="m-0 text-sm text-muted">Para médicos, residentes e estudantes. Sem anúncios, sem feed infinito, sem rede social.</p>
          </div>

          <aside aria-labelledby="previa" className="border border-line bg-surface p-5">
            <div className="flex items-center justify-between border-b-2 border-primary pb-2">
              <h2 id="previa" className="m-0 flex items-center gap-2 font-serif text-lg font-semibold text-primary"><SealMini size={22} />{brand}</h2>
              <span className="text-xs text-muted first-letter:uppercase">{e ? fmtLongDate(e.date) : ''}</span>
            </div>
            {e?.isDemo && <p className="chip chip-demo mt-3">Prévia com estudos fictícios de demonstração</p>}
            {preview.map((a, i) => a && (
              <div key={a.id} className={`grid gap-2 py-4 ${i ? 'border-t border-line' : ''}`}>
                <p className="kicker m-0 text-muted">{a.topics[0]?.label} · {designLabels[a.studyDesign]}</p>
                <p className={`m-0 font-serif leading-snug font-bold ${i ? 'text-lg' : 'text-2xl'}`}>{a.headline}</p>
                {i === 0 && a.keyResult && <KeyResultPanel k={a.keyResult} compact />}
              </div>
            ))}
            {!e && !ed.isLoading && <p className="py-6 text-muted">A prévia aparece quando houver uma edição publicada.</p>}
          </aside>
        </section>

        <section id="como" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
            {[
              ['Poupa tempo', 'Em vez de abrir dezenas de bases e revistas, você lê uma edição organizada por área, com começo e fim.'],
              ['Mostra os números', 'Medida de efeito, intervalo de confiança e p-valor exatamente como foram reportados — e o que não foi reportado aparece como ausente.'],
              ['Separa achado de conduta', 'Associação não vira causa, resultado negativo também é notícia e nenhuma análise vira recomendação para pacientes.'],
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
            <h2 className="m-0 font-serif text-3xl font-bold">Assinatura</h2>
            <p className="max-w-prose text-muted">Sem anúncios: o jornal é mantido por quem lê. Valores do beta em avaliação.</p>
            <div className="mt-4 flex flex-wrap gap-8">
              {plans.data?.items.map((p) => (
                <div key={p.id}>
                  <p className="kicker m-0 text-muted">{p.name}</p>
                  <p className="tnum m-0 font-serif text-4xl font-bold">{fmtBRL(p.priceCents)}<span className="font-sans text-base font-normal text-muted">/mês</span></p>
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
          {brand} é um conteúdo informativo para profissionais de saúde e não orienta conduta para pacientes. <Link to="/privacidade" className="link">Privacidade e termos</Link>
        </p>
      </footer>
    </div>
  );
}
