import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, fmtDateTime } from '../lib/api';
import { ErrorState, Loading, PageTitle } from '../components/ui';

const Wrap = ({ children }: { children: React.ReactNode }) => <div className="prose-jm mx-auto max-w-3xl px-4 pb-10">{children}</div>;

export function Metodologia() {
  return (
    <Wrap>
      <PageTitle kicker="Como trabalhamos" title="Metodologia e fontes" />
      <h2 className="font-serif text-2xl font-bold">1. Descoberta</h2>
      <p>Consultamos fontes bibliográficas por API oficial (no beta, o PubMed via NCBI E-utilities), com consultas versionadas por tema e janela de datas sobreposta para captar indexação tardia. Não pedimos a modelos de linguagem que “encontrem” ou lembrem estudos.</p>
      <h2 className="font-serif text-2xl font-bold">2. Triagem</h2>
      <p>Regras explícitas: tipo de publicação (ensaios, revisões sistemáticas, metanálises, diretrizes, estudos observacionais), idioma, presença de resumo e status de retratação. Resultado negativo nunca é motivo de exclusão. Registros duplicados são unidos por DOI, PMID ou PMCID; títulos parecidos viram candidatos para revisão, sem fusão automática.</p>
      <h2 className="font-serif text-2xl font-bold">3. Extração e síntese</h2>
      <p>Um modelo de IA (OpenAI) recebe apenas o material autorizado — no beta, o abstract — e devolve um objeto estruturado: desenho, população, desfechos, medidas de efeito, intervalos de confiança, p-valores, limitações e de onde cada informação saiu. Uma segunda etapa redige a manchete e o resumo usando só os dados já validados.</p>
      <h2 className="font-serif text-2xl font-bold">4. Validação</h2>
      <p>Verificações automáticas: limites do intervalo coerentes com a estimativa, p-valor entre 0 e 1, desigualdades preservadas (p &lt; 0,001 não vira p = 0,001), cada número presente no texto de origem, trechos citados encontrados literalmente, sinais de instruções maliciosas no documento. Divergências bloqueiam ou sinalizam o item para revisão — nunca são “corrigidas” pela máquina.</p>
      <h2 className="font-serif text-2xl font-bold">5. Revisão editorial</h2>
      <p>Nada real é publicado sem aprovação de um editor, registrada com identidade interna e horário. Correções geram nova versão e um aviso visível; retratações aparecem destacadas e tiram o estudo das recomendações.</p>
      <h2 className="font-serif text-2xl font-bold">6. Força da evidência (A1 a C3) e Qualis</h2>
      <p>Cada estudo recebe uma nota de A1 (mais forte) a C3 (mais fraca), calculada por regras fixas, sem IA. A letra vem do desenho: <strong>A</strong> para metanálise, revisão sistemática e ensaio randomizado; <strong>B</strong> para coorte, caso-controle, acurácia diagnóstica, diretriz e avaliação econômica; <strong>C</strong> para os demais. O número (1 a 3) piora quando o resultado principal não tem intervalo de confiança nem p-valor, quando a amostra tem menos de 500 participantes (ou não é informada) e quando a validação encontrou incerteza nos números. Estudo retratado é sempre C3. Cada nota mostra o motivo.</p>
      <p>Ao lado aparece o <strong>Qualis CAPES 2021–2024 da revista</strong> (A1 a C), consultado na Plataforma Sucupira. O Qualis classifica a revista para a avaliação da pós-graduação, não a qualidade do estudo; por isso ele não entra na nota do estudo e só serve de desempate na ordem da capa. A manchete e os destaques são os estudos com a melhor nota.</p>
      <h2 className="font-serif text-2xl font-bold">O que não fazemos</h2>
      <p>Não aplicamos automaticamente instrumentos formais (RoB 2, ROBINS-I, AMSTAR 2, GRADE); a nota A1–C3 é uma triagem editorial simples, não um GRADE. Mostramos apenas sinais preliminares de viés quando o texto os traz. Não usamos o prestígio do periódico, o p-valor ou a popularidade como prova de validade.</p>
    </Wrap>
  );
}

export function Privacidade() {
  return (
    <Wrap>
      <PageTitle kicker="Rascunho para revisão jurídica" title="Privacidade e termos" />
      <p className="border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm text-warning">Texto provisório. A conformidade com a LGPD depende de revisão por profissional jurídico antes do lançamento.</p>
      <h2 className="font-serif text-2xl font-bold">Dados que coletamos</h2>
      <p>E-mail (para acesso), perfil profissional opcional, temas e fontes seguidos, artigos salvos, eventos de leitura (abertura e conclusão, agregados por dia), feedback e relatos de erro, e situação da assinatura. Não coletamos prontuários, dados de pacientes ou condições de saúde.</p>
      <h2 className="font-serif text-2xl font-bold">Para que usamos</h2>
      <p>Acesso à conta, personalização da seleção “Para você” (pode ser desligada), contagem agregada de mais lidos e cobrança. Não usamos rastreamento publicitário. Dados de leitura não entram nos prompts enviados ao provedor de IA.</p>
      <h2 className="font-serif text-2xl font-bold">Seus direitos</h2>
      <p>Em <Link to="/configuracoes" className="link">Preferências</Link> você exporta seus dados, apaga histórico e sinais, encerra sessões e exclui a conta.</p>
      <h2 className="font-serif text-2xl font-bold">Natureza do conteúdo</h2>
      <p>Conteúdo informativo para profissionais de saúde, produzido com apoio de IA e revisão editorial. Não constitui orientação diagnóstica ou terapêutica individual.</p>
    </Wrap>
  );
}

export function CaixaDev() {
  const [sp] = useSearchParams();
  const email = sp.get('email') ?? '';
  const q = useQuery({
    queryKey: ['outbox', email],
    queryFn: () => api<{ notice: string; items: { to_email: string; subject: string; body: string; created_at: string }[] }>(`/dev/outbox${email ? `?email=${encodeURIComponent(email)}` : ''}`),
    refetchInterval: 3000,
  });
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10">
      <PageTitle kicker="Somente desenvolvimento" title="Caixa postal local" />
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && <p className="border-2 border-dashed border-warning p-3 text-sm font-semibold text-warning">{q.data.notice}</p>}
      <ul className="m-0 list-none p-0">
        {q.data?.items.map((m) => (
          <li key={m.created_at + m.to_email} className="border-t border-line py-3">
            <p className="m-0 text-xs text-muted">{fmtDateTime(m.created_at)} · para {m.to_email}</p>
            <p className="m-0 font-semibold" data-testid="outbox-subject">{m.subject}</p>
            <pre className="m-0 mt-1 font-sans text-sm whitespace-pre-wrap">{m.body}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NaoEncontrado() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-serif text-4xl font-bold">Página não encontrada</h1>
      <p className="text-muted">O endereço pode ter mudado. <Link to="/jornal" className="link">Ir para a edição de hoje</Link>.</p>
    </div>
  );
}
