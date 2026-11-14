// Dados de semente: taxonomia (proposta de navegação, não classificação oficial do CFM),
// fontes, planos, flags e conteúdo de DEMONSTRAÇÃO inequivocamente fictício.
import type { AiAnalysis } from '@jm/contracts';

type T = { slug: string; label: string; en?: string; enabled?: boolean; color?: string; mesh?: string[]; query?: string; syn?: string[]; extra?: string[]; children?: T[] };

const q = (terms: string) =>
  `(${terms}) AND (Randomized Controlled Trial[pt] OR Meta-Analysis[pt] OR Systematic Review[pt] OR Practice Guideline[pt] OR Guideline[pt] OR Observational Study[pt]) AND (english[la] OR portuguese[la] OR spanish[la])`;

export const taxonomy: T[] = [
  {
    slug: 'clinica-medica', label: 'Clínica médica', en: 'Internal medicine', enabled: true, color: '#13564D',
    children: [
      {
        slug: 'cardiologia', label: 'Cardiologia', en: 'Cardiology', enabled: true, color: '#A4383A',
        children: [
          { slug: 'hipertensao-arterial', label: 'Hipertensão arterial', en: 'Hypertension', enabled: true, mesh: ['Hypertension'], syn: ['HAS', 'pressão alta'], query: q('"Hypertension"[MeSH Terms] OR hypertension[tiab]') },
          { slug: 'insuficiencia-cardiaca', label: 'Insuficiência cardíaca', en: 'Heart failure', enabled: true, mesh: ['Heart Failure'], syn: ['IC'], query: q('"Heart Failure"[MeSH Terms] OR "heart failure"[tiab]') },
          { slug: 'arritmias', label: 'Arritmias', en: 'Arrhythmias', mesh: ['Arrhythmias, Cardiac'], enabled: true, query: q('"Arrhythmias, Cardiac"[MeSH Terms] OR "atrial fibrillation"[tiab] OR arrhythmia*[ti]') },
          { slug: 'coronariopatias', label: 'Doença coronariana', en: 'Coronary disease', mesh: ['Coronary Disease'], enabled: true, query: q('"Coronary Disease"[MeSH Terms] OR "acute coronary syndrome"[tiab] OR "myocardial infarction"[ti]') },
        ],
      },
      {
        slug: 'endocrinologia', label: 'Endocrinologia', en: 'Endocrinology', enabled: true, color: '#285A75',
        children: [
          { slug: 'diabetes', label: 'Diabetes', en: 'Diabetes mellitus', enabled: true, mesh: ['Diabetes Mellitus'], syn: ['DM2', 'DM1'], query: q('"Diabetes Mellitus"[MeSH Terms] OR diabetes[tiab]') },
          { slug: 'tireoide', label: 'Tireoide', en: 'Thyroid diseases', mesh: ['Thyroid Diseases'], enabled: true, query: q('"Thyroid Diseases"[MeSH Terms] OR hypothyroidism[ti] OR hyperthyroidism[ti]') },
          { slug: 'obesidade', label: 'Obesidade', en: 'Obesity', mesh: ['Obesity'], enabled: true, query: q('"Obesity"[MeSH Terms] OR obesity[ti]') },
        ],
      },
      { slug: 'pneumologia', label: 'Pneumologia', en: 'Pulmonology', enabled: true, color: '#4D5E8A', children: [
        { slug: 'asma', label: 'Asma', en: 'Asthma', mesh: ['Asthma'], enabled: true, query: q('"Asthma"[MeSH Terms] OR asthma[ti]') },
        { slug: 'dpoc', label: 'DPOC', en: 'COPD', mesh: ['Pulmonary Disease, Chronic Obstructive'], enabled: true, query: q('"Pulmonary Disease, Chronic Obstructive"[MeSH Terms] OR COPD[ti]') },
      ] },
      { slug: 'nefrologia', label: 'Nefrologia', en: 'Nephrology', enabled: true, query: q('"Renal Insufficiency, Chronic"[MeSH Terms] OR "chronic kidney disease"[ti] OR "acute kidney injury"[ti]') },
      { slug: 'gastroenterologia', label: 'Gastroenterologia', en: 'Gastroenterology', enabled: true, query: q('"Gastrointestinal Diseases"[MeSH Major Topic] OR cirrhosis[ti] OR "inflammatory bowel disease"[ti]') },
      { slug: 'infectologia', label: 'Infectologia', en: 'Infectious diseases', enabled: true, query: q('"Communicable Diseases"[MeSH Terms] OR sepsis[ti] OR pneumonia[ti] OR HIV[ti]') },
      { slug: 'hematologia', label: 'Hematologia', en: 'Hematology', enabled: true, query: q('"Anemia"[MeSH Terms] OR "venous thromboembolism"[ti] OR anticoagula*[ti]') },
      { slug: 'reumatologia', label: 'Reumatologia', en: 'Rheumatology', enabled: true, query: q('"Rheumatic Diseases"[MeSH Terms] OR "rheumatoid arthritis"[ti] OR lupus[ti] OR gout[ti]') },
      { slug: 'neurologia', label: 'Neurologia', en: 'Neurology', enabled: true, query: q('"Stroke"[MeSH Terms] OR stroke[ti] OR epilepsy[ti] OR migraine[ti]') },
      { slug: 'geriatria', label: 'Geriatria', en: 'Geriatrics', enabled: true, query: q('"Aged, 80 and over"[MeSH Terms] AND (frailty[tiab] OR delirium[tiab] OR falls[tiab] OR deprescribing[tiab])') },
    ],
  },
  {
    slug: 'cirurgia-geral', label: 'Cirurgia geral', en: 'General surgery', enabled: true, color: '#6B4E2E',
    children: [
      { slug: 'perioperatorio', label: 'Perioperatório', en: 'Perioperative care', enabled: true, query: q('"Perioperative Care"[MeSH Terms] OR perioperative[ti] OR postoperative[ti]') },
      { slug: 'cirurgia-abdominal', label: 'Cirurgia abdominal', en: 'Abdominal surgery', enabled: true, query: q('appendicitis[ti] OR cholecystectomy[ti] OR "hernia"[ti] OR laparoscop*[ti]') },
      { slug: 'cirurgia-vascular', label: 'Vascular', en: 'Vascular surgery', enabled: true, query: q('"Vascular Surgical Procedures"[MeSH Terms] OR "aortic aneurysm"[ti] OR "peripheral artery disease"[ti]') },
      { slug: 'trauma', label: 'Trauma', en: 'Trauma', enabled: true, query: q('"Wounds and Injuries"[MeSH Major Topic] OR trauma[ti]') },
      { slug: 'transplante', label: 'Transplante', en: 'Transplantation', enabled: true, query: q('"Organ Transplantation"[MeSH Terms] OR transplant*[ti]') },
    ],
  },
  {
    slug: 'pediatria', label: 'Pediatria', en: 'Pediatrics', enabled: true, color: '#2F6B8A',
    children: [
      { slug: 'neonatologia', label: 'Neonatologia', en: 'Neonatology', enabled: true, query: q('"Infant, Newborn"[MeSH Terms] AND (preterm[tiab] OR neonatal[ti])') },
      { slug: 'desenvolvimento-infantil', label: 'Desenvolvimento', en: 'Child development', enabled: true, query: q('"Child Development"[MeSH Terms] OR "early childhood"[ti] OR breastfeeding[ti]') },
      { slug: 'imunizacao', label: 'Imunização', en: 'Immunization', extra: ['medicina-preventiva-social'], enabled: true, query: q('"Vaccination"[MeSH Terms] OR vaccine*[ti] OR immunization[ti]') },
      { slug: 'pediatria-respiratoria', label: 'Doenças respiratórias e infecciosas', en: 'Respiratory and infectious diseases', enabled: true, query: q('"Child"[MeSH Terms] AND (bronchiolitis[ti] OR pneumonia[ti] OR "respiratory infection"[ti])') },
    ],
  },
  {
    slug: 'ginecologia-obstetricia', label: 'Ginecologia e obstetrícia', en: 'Obstetrics and gynecology', enabled: true, color: '#7A3E5C',
    children: [
      { slug: 'pre-natal', label: 'Pré-natal e gestação', en: 'Prenatal care', enabled: true, query: q('"Prenatal Care"[MeSH Terms] OR pregnancy[ti] OR "gestational diabetes"[ti]') },
      { slug: 'hipertensao-gestacional', label: 'Hipertensão na gestação', en: 'Hypertension in pregnancy', extra: ['cardiologia'], enabled: true, query: q('"Hypertension, Pregnancy-Induced"[MeSH Terms] OR preeclampsia[ti] OR pre-eclampsia[ti]') },
      { slug: 'puerperio', label: 'Puerpério', en: 'Postpartum', enabled: true, query: q('"Postpartum Period"[MeSH Terms] OR postpartum[ti] OR "postpartum hemorrhage"[ti]') },
      { slug: 'ginecologia-clinica', label: 'Ginecologia clínica', en: 'Clinical gynecology', enabled: true, query: q('endometriosis[ti] OR "polycystic ovary"[ti] OR contracepti*[ti] OR menopaus*[ti]') },
    ],
  },
  {
    slug: 'medicina-preventiva-social', label: 'Medicina preventiva e social', en: 'Preventive and social medicine', enabled: true, color: '#3E6B3A',
    children: [
      { slug: 'epidemiologia', label: 'Epidemiologia', en: 'Epidemiology', enabled: true, query: q('"Epidemiologic Studies"[MeSH Terms] AND (incidence[ti] OR prevalence[ti] OR burden[ti])') },
      { slug: 'atencao-primaria', label: 'Atenção primária', en: 'Primary care', enabled: true, query: q('"Primary Health Care"[MeSH Terms] OR "primary care"[ti] OR "general practice"[ti]') },
      { slug: 'rastreamento', label: 'Rastreamento', en: 'Screening', enabled: true, query: q('"Mass Screening"[MeSH Terms] OR screening[ti]') },
      { slug: 'politicas-publicas', label: 'Políticas públicas', en: 'Health policy', enabled: true, query: q('"Health Policy"[MeSH Terms] OR "public health"[ti] OR "health system"[ti]') },
    ],
  },
];

export const sources = [
  { slug: 'demo', name: 'Fixture de demonstração', kind: 'fixture', url: 'https://example.invalid/demo', status: 'active', enabled: 1, rate: 1, license: 'Conteúdo fictício criado para demonstração. Não é pesquisa real.' },
  { slug: 'pubmed', name: 'PubMed (NCBI E-utilities)', kind: 'bibliographic_api', url: 'https://pubmed.ncbi.nlm.nih.gov/', status: 'active', enabled: 1, rate: 3, license: 'Metadados via E-utilities sob a política do NCBI. Abstracts podem ter direitos autorais do editor: uso interno para revisão, não republicados. Uso comercial pendente de validação jurídica.' },
  { slug: 'europepmc', name: 'Europe PMC', kind: 'bibliographic_api', url: 'https://europepmc.org/RestfulWebService', status: 'planned', enabled: 0, rate: 5, license: 'Verificar licença por registro antes de processar texto.' },
  { slug: 'crossref', name: 'Crossref', kind: 'metadata_api', url: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/', status: 'active', enabled: 1, rate: 5, license: 'Metadados bibliográficos; não implica acesso ao texto.' },
  { slug: 'scielo', name: 'SciELO', kind: 'bibliographic_portal', url: 'https://scielo.org/', status: 'planned', enabled: 0, rate: 1, license: 'Verificar canais oficiais e licença CC por artigo.' },
  { slug: 'sbc', name: 'Sociedade Brasileira de Cardiologia', kind: 'society_guidelines', url: 'https://www.cardiol.br/', status: 'planned', enabled: 0, rate: 1, license: 'Cadastro manual de diretrizes (link e metadados) até existir feed autorizado.' },
  { slug: 'sbd', name: 'Sociedade Brasileira de Diabetes', kind: 'society_guidelines', url: 'https://diabetes.org.br/', status: 'planned', enabled: 0, rate: 1, license: 'Cadastro manual de diretrizes (link e metadados) até existir feed autorizado.' },
  { slug: 'conitec', name: 'Conitec / Ministério da Saúde', kind: 'government', url: 'https://www.gov.br/conitec/', status: 'planned', enabled: 0, rate: 1, license: 'Documentos públicos oficiais; registrar versão.' },
];

export const plans = [
  { slug: 'beta-mensal', name: 'Beta mensal', price: 4990, active: 1, description: 'Preço de lançamento em avaliação (hipótese comercial, não definitiva).' },
  { slug: 'referencia-mensal', name: 'Mensal', price: 9990, active: 0, description: 'Preço de referência futuro (hipótese comercial).' },
];

export const flags = [
  { key: 'real_content', env: 'FEATURE_REAL_CONTENT', description: 'Leitores veem edições reais (revisadas). Desligado: só a edição de demonstração.' },
  { key: 'ai_preview', env: 'FEATURE_AI_PREVIEW', description: 'Prévia interna: leitores veem análises reais geradas por IA ainda sem revisão editorial, com rótulo "não revisado". Exige real_content.' },
  { key: 'notion', env: 'FEATURE_NOTION', description: 'Exportação para Notion (não implementada).' },
  { key: 'clickup', env: 'FEATURE_CLICKUP', description: 'Exportação para ClickUp (não implementada).' },
  { key: 'audio', env: 'FEATURE_AUDIO', description: 'Narração por ElevenLabs (não implementada).' },
  { key: 'video', env: 'FEATURE_VIDEO', description: 'Vídeo-resumo (não implementado).' },
  { key: 'pwa', env: 'FEATURE_PWA', description: 'Instalação como PWA (não implementada).' },
];

// ---------------- Conteúdo de demonstração ----------------
type DemoResult = Partial<AiAnalysis['results'][number]> & { outcome: string };
export interface DemoArticle {
  code: string;
  topics: string[];
  title: string;
  headline: string;
  design: AiAnalysis['studyDesign'];
  pubTypes: string[];
  daysAgo: number;
  priority: number;
  status: 'demo' | 'in_review';
  retracted?: boolean;
  summary: string;
  inShort: string;
  context: string;
  objective: string;
  population: string;
  sampleSize: number | null;
  followUp: string | null;
  intervention: string | null;
  comparator: string | null;
  methods: string;
  results: DemoResult[];
  implications: string;
  applicability: string;
  limitations: string[];
  rob: string | null;
  funding: string | null;
  coi: string | null;
  missing?: AiAnalysis['missingFields'];
  flags?: AiAnalysis['reviewFlags'];
  edition: 'today' | 'yesterday' | 'none';
  slot?: 'headline' | 'secondary' | 'section';
}

const R = (r: DemoResult): DemoResult => r;

export const demoArticles: DemoArticle[] = [
  {
    code: 'DEMO-001', topics: ['hipertensao-arterial'], edition: 'today', slot: 'headline',
    title: 'DEMO-001 — Fictitious trial: intensive versus standard blood-pressure target in older adults (demonstration)',
    headline: 'Estudo fictício: meta pressórica intensiva reduziu eventos cardiovasculares em idosos, com mais hipotensão',
    design: 'rct', pubTypes: ['Randomized Controlled Trial'], daysAgo: 1, priority: 0.92, status: 'demo',
    summary: 'Este é um estudo fictício criado para demonstrar a plataforma. No cenário simulado, idosos hipertensos foram randomizados para meta sistólica intensiva ou padrão. O desfecho composto cardiovascular foi menos frequente no grupo intensivo. Eventos de hipotensão foram mais frequentes nesse mesmo grupo. Nenhum dado deste texto existe na literatura.',
    inShort: 'Cenário fictício: meta intensiva com menos eventos cardiovasculares e mais hipotensão. Serve apenas para mostrar o formato.',
    context: 'Texto de demonstração: o controle pressórico em idosos envolve equilíbrio entre benefício cardiovascular e eventos adversos.',
    objective: 'Comparar (de forma fictícia) duas metas de pressão sistólica em pessoas com 70 anos ou mais.',
    population: 'Participantes fictícios com 70 anos ou mais e hipertensão tratada.', sampleSize: 2400, followUp: '3 anos (fictício)',
    intervention: 'Meta sistólica < 120 mmHg (fictícia)', comparator: 'Meta sistólica < 140 mmHg (fictícia)',
    methods: 'Ensaio aberto, randomizado, multicêntrico — tudo simulado para demonstração.',
    results: [
      R({ outcome: 'Desfecho composto cardiovascular', outcomeType: 'primary', measure: 'HR', measureKind: 'ratio', estimate: 0.78, estimateRaw: '0,78', confidenceInterval: { level: 95, lower: 0.64, upper: 0.95, raw: '0,64–0,95' }, pValue: { raw: 'p = 0,01', operator: '=', value: 0.01 }, sampleSize: 2400, adjusted: false, comparator: 'meta padrão', timepoint: '3 anos', population: 'Intenção de tratar' }),
      R({ outcome: 'Hipotensão sintomática', outcomeType: 'safety', measure: 'RR', measureKind: 'ratio', estimate: 1.45, estimateRaw: '1,45', confidenceInterval: { level: 95, lower: 1.1, upper: 1.91, raw: '1,10–1,91' }, pValue: { raw: 'p = 0,008', operator: '=', value: 0.008 }, sampleSize: 2400, comparator: 'meta padrão', timepoint: '3 anos' }),
      R({ outcome: 'Mortalidade por todas as causas', outcomeType: 'secondary', measure: 'HR', measureKind: 'ratio', estimate: 0.91, estimateRaw: '0,91', confidenceInterval: { level: 95, lower: 0.72, upper: 1.15, raw: '0,72–1,15' }, pValue: { raw: 'p = 0,43', operator: '=', value: 0.43 }, sampleSize: 2400, comparator: 'meta padrão', timepoint: '3 anos' }),
    ],
    implications: 'Em um estudo real com esse perfil, o benefício cardiovascular precisaria ser pesado contra eventos adversos. Este texto não constitui orientação clínica.',
    applicability: 'Exemplo de como a plataforma descreve a população à qual um resultado se aplica.',
    limitations: ['Estudo aberto (fictício): risco de viés de desempenho.', 'Desfecho secundário de mortalidade sem diferença estatística — não prova ausência de efeito.', 'Conteúdo inteiramente simulado.'],
    rob: 'Sinais preliminares (fictícios): randomização descrita; ausência de cegamento.', funding: 'Não se aplica (demonstração).', coi: 'Não se aplica (demonstração).',
  },
  {
    code: 'DEMO-002', topics: ['diabetes', 'insuficiencia-cardiaca'], edition: 'today', slot: 'secondary',
    title: 'DEMO-002 — Fictitious cohort: glycemic variability and heart-failure hospitalization (demonstration)',
    headline: 'Coorte fictícia associa variabilidade glicêmica a internação por insuficiência cardíaca',
    design: 'cohort', pubTypes: ['Observational Study'], daysAgo: 2, priority: 0.74, status: 'demo',
    summary: 'Estudo fictício de demonstração. Uma coorte simulada de pessoas com diabetes tipo 2 mostrou associação entre maior variabilidade glicêmica e internação por insuficiência cardíaca. Por ser observacional, o desenho não permite concluir causalidade. Os números são inventados para exibir o formato.',
    inShort: 'Associação, não causalidade: exemplo de como a plataforma separa os dois.',
    context: 'Demonstração de estudo observacional com ajuste para confundidores.', objective: 'Avaliar associação (fictícia) entre variabilidade glicêmica e internação por IC.',
    population: 'Coorte fictícia de adultos com diabetes tipo 2.', sampleSize: 18500, followUp: 'mediana de 5 anos (fictícia)',
    intervention: 'Exposição: quartil superior de variabilidade glicêmica', comparator: 'Quartil inferior',
    methods: 'Coorte retrospectiva simulada com modelo de Cox ajustado.',
    results: [
      R({ outcome: 'Internação por insuficiência cardíaca', outcomeType: 'primary', measure: 'HR ajustado', measureKind: 'ratio', estimate: 1.32, estimateRaw: '1,32', confidenceInterval: { level: 95, lower: 1.12, upper: 1.55, raw: '1,12–1,55' }, pValue: { raw: 'p < 0,001', operator: '<', value: 0.001 }, adjusted: true, comparator: 'quartil inferior', sampleSize: 18500 }),
    ],
    implications: 'Associação observacional; não demonstra que reduzir a variabilidade reduz internações.', applicability: 'Exemplo ilustrativo.',
    limitations: ['Confundimento residual possível.', 'Desenho retrospectivo (fictício).'], rob: 'Sinais preliminares: risco de confundimento.', funding: null, coi: null,
    missing: [{ field: 'funding', reason: 'not_reported_in_available_material' }, { field: 'conflictsOfInterest', reason: 'not_reported_in_available_material' }],
  },
  {
    code: 'DEMO-003', topics: ['insuficiencia-cardiaca'], edition: 'today', slot: 'secondary',
    title: 'DEMO-003 — Fictitious trial with neutral result in heart failure with preserved ejection fraction (demonstration)',
    headline: 'Resultado negativo também é notícia: ensaio fictício sem diferença no desfecho primário em IC',
    design: 'rct', pubTypes: ['Randomized Controlled Trial'], daysAgo: 1, priority: 0.7, status: 'demo',
    summary: 'Estudo fictício de demonstração. Um ensaio simulado em insuficiência cardíaca com fração de ejeção preservada não encontrou diferença estatística no desfecho primário. A plataforma destaca resultados neutros com o mesmo cuidado que resultados positivos. Um resultado não significativo não prova ausência de efeito.',
    inShort: 'Sem diferença estatística no desfecho primário — e o intervalo ainda é compatível com pequeno benefício ou dano.',
    context: 'Demonstração de resultado neutro.', objective: 'Avaliar (de forma fictícia) um fármaco experimental versus placebo.',
    population: 'Participantes fictícios com ICFEp.', sampleSize: 3100, followUp: '26 meses (fictício)', intervention: 'Fármaco fictício X', comparator: 'Placebo',
    methods: 'Ensaio duplo-cego simulado.',
    results: [
      R({ outcome: 'Morte cardiovascular ou internação por IC', outcomeType: 'primary', measure: 'HR', measureKind: 'ratio', estimate: 0.97, estimateRaw: '0,97', confidenceInterval: { level: 95, lower: 0.85, upper: 1.11, raw: '0,85–1,11' }, pValue: { raw: 'p = 0,66', operator: '=', value: 0.66 }, comparator: 'placebo', sampleSize: 3100 }),
    ],
    implications: 'O intervalo de confiança inclui tanto pequeno benefício quanto pequeno dano.', applicability: 'Exemplo ilustrativo.',
    limitations: ['Poder estatístico pode ser insuficiente para efeitos pequenos (fictício).'], rob: 'Sinais preliminares: duplo-cego descrito.', funding: 'Fictício', coi: 'Fictício',
  },
  {
    code: 'DEMO-004', topics: ['hipertensao-arterial'], edition: 'today', slot: 'section',
    title: 'DEMO-004 — Fictitious society guideline on home blood-pressure monitoring (demonstration)',
    headline: 'Diretriz fictícia de demonstração reorganiza recomendações de monitorização residencial',
    design: 'guideline', pubTypes: ['Practice Guideline'], daysAgo: 3, priority: 0.66, status: 'demo',
    summary: 'Documento fictício que imita a estrutura de uma diretriz. Não existe sociedade nem recomendação real por trás deste texto. Diretrizes não têm p-valor; a plataforma mostra instituição, método, versão e força das recomendações quando informados.',
    inShort: 'Diretriz não tem p-valor: o que importa é método, versão e força de recomendação.',
    context: 'Demonstração de como diretrizes são apresentadas.', objective: 'Ilustrar o formato de diretriz.',
    population: 'Adultos com hipertensão (cenário fictício).', sampleSize: null, followUp: null, intervention: null, comparator: null,
    methods: 'Consenso de especialistas fictício; método de graduação não informado.',
    results: [],
    implications: 'Em diretrizes reais, verificar data, versão, população e força de cada recomendação antes de aplicá-la.', applicability: 'Exemplo ilustrativo.',
    limitations: ['Método de graduação não informado (fictício).'], rob: null, funding: null, coi: null,
    missing: [{ field: 'results', reason: 'not_applicable' }, { field: 'riskOfBias', reason: 'not_applicable' }],
  },
  {
    code: 'DEMO-005', topics: ['diabetes'], edition: 'today', slot: 'section',
    title: 'DEMO-005 — Fictitious meta-analysis of structured exercise in type 2 diabetes (demonstration)',
    headline: 'Metanálise fictícia: exercício estruturado associado a menor risco de complicações, com heterogeneidade alta',
    design: 'meta_analysis', pubTypes: ['Meta-Analysis', 'Systematic Review'], daysAgo: 2, priority: 0.62, status: 'demo',
    summary: 'Metanálise fictícia de demonstração. O efeito combinado simulado favorece o exercício estruturado, mas a heterogeneidade entre os estudos é alta. Em revisões, a plataforma mostra critérios, heterogeneidade e qualidade dos estudos incluídos.',
    inShort: 'Efeito combinado favorável, mas heterogeneidade alta reduz a confiança.',
    context: 'Demonstração de revisão sistemática.', objective: 'Ilustrar apresentação de metanálise.',
    population: '14 ensaios fictícios, 6.200 participantes fictícios.', sampleSize: 6200, followUp: null, intervention: 'Exercício estruturado', comparator: 'Cuidado usual',
    methods: 'Modelo de efeitos aleatórios (fictício).',
    results: [
      R({ outcome: 'Complicações microvasculares', outcomeType: 'primary', measure: 'RR', measureKind: 'ratio', estimate: 0.85, estimateRaw: '0,85', confidenceInterval: { level: 95, lower: 0.76, upper: 0.95, raw: '0,76–0,95' }, pValue: null, sampleSize: 6200, missingReason: 'p-valor não reportado no material disponível' }),
      R({ outcome: 'Heterogeneidade (I²)', outcomeType: 'other', measure: 'I²', measureKind: 'proportion', estimate: 62, estimateRaw: '62%', unit: '%', confidenceInterval: null, pValue: null, missingReason: 'IC não reportado' }),
    ],
    implications: 'Heterogeneidade alta: o efeito pode variar entre populações e protocolos.', applicability: 'Exemplo ilustrativo.',
    limitations: ['Heterogeneidade alta.', 'Qualidade dos estudos incluídos variável (fictício).'], rob: 'Sinais preliminares: avaliação formal (AMSTAR 2) não realizada pela plataforma.', funding: null, coi: null,
  },
  {
    code: 'DEMO-006', topics: ['diabetes'], edition: 'yesterday', slot: 'secondary', retracted: true,
    title: 'DEMO-006 — Fictitious retracted study (demonstration of retraction notice)',
    headline: 'Estudo fictício retratado: como a plataforma avisa sobre retratações',
    design: 'rct', pubTypes: ['Randomized Controlled Trial', 'Retracted Publication'], daysAgo: 6, priority: 0.5, status: 'demo',
    summary: 'Item fictício para demonstrar o aviso de retratação. Estudos retratados permanecem no histórico das edições, com aviso destacado, e saem das recomendações.',
    inShort: 'Exemplo do aviso de retratação.',
    context: 'Demonstração.', objective: 'Demonstrar fluxo de retratação.', population: 'Fictícia.', sampleSize: 400, followUp: null, intervention: 'Fictícia', comparator: 'Fictício',
    methods: 'Fictício.', results: [R({ outcome: 'HbA1c', outcomeType: 'primary', measure: 'Diferença de médias', measureKind: 'difference', estimate: -0.4, estimateRaw: '−0,4', unit: 'pontos percentuais', confidenceInterval: { level: 95, lower: -0.6, upper: -0.2, raw: '−0,6 a −0,2' }, pValue: { raw: 'p < 0,001', operator: '<', value: 0.001 } })],
    implications: 'Resultados de estudos retratados não devem ser usados.', applicability: 'Exemplo ilustrativo.', limitations: ['Retratado (fictício).'], rob: null, funding: null, coi: null,
  },
  {
    code: 'DEMO-007', topics: ['hipertensao-arterial'], edition: 'yesterday', slot: 'headline',
    title: 'DEMO-007 — Fictitious cross-sectional survey of hypertension awareness (demonstration)',
    headline: 'Inquérito fictício estima que um terço dos adultos simulados tinha hipertensão',
    design: 'cross_sectional', pubTypes: ['Observational Study'], daysAgo: 5, priority: 0.58, status: 'demo',
    summary: 'Estudo transversal fictício de demonstração. A prevalência simulada foi de cerca de um terço. Estudos transversais medem prevalência e associação num ponto do tempo, sem estabelecer temporalidade.',
    inShort: 'Prevalência num ponto do tempo; sem temporalidade nem causalidade.',
    context: 'Demonstração.', objective: 'Ilustrar proporção com IC.', population: 'Amostra fictícia de 2.000 adultos.', sampleSize: 2000, followUp: null, intervention: null, comparator: null,
    methods: 'Amostragem fictícia por conglomerados.',
    results: [R({ outcome: 'Prevalência de hipertensão', outcomeType: 'primary', measure: 'Proporção', measureKind: 'proportion', estimate: 34.2, estimateRaw: '34,2%', unit: '%', confidenceInterval: { level: 95, lower: 31, upper: 37.5, raw: '31,0–37,5' }, pValue: null, sampleSize: 2000, missingReason: 'p-valor não se aplica a estimativa de prevalência' })],
    implications: 'Dados de prevalência ajudam a dimensionar o problema; não avaliam tratamento.', applicability: 'Exemplo ilustrativo.',
    limitations: ['Medida única de pressão (fictício).'], rob: null, funding: null, coi: null,
  },
  {
    code: 'DEMO-008', topics: ['insuficiencia-cardiaca'], edition: 'yesterday', slot: 'section',
    title: 'DEMO-008 — Fictitious abstract-only trial with unreported confidence interval (demonstration)',
    headline: 'Quando o abstract não traz o intervalo de confiança: exemplo de dado ausente',
    design: 'rct', pubTypes: ['Randomized Controlled Trial'], daysAgo: 4, priority: 0.45, status: 'demo',
    summary: 'Item fictício que mostra como a plataforma lida com dados ausentes. O abstract simulado relata uma estimativa sem intervalo de confiança; a plataforma não calcula nem inventa o intervalo.',
    inShort: 'Dado ausente fica visível como ausente — nunca é preenchido.',
    context: 'Demonstração.', objective: 'Demonstrar campo ausente.', population: 'Fictícia.', sampleSize: 620, followUp: '12 meses (fictício)', intervention: 'Programa fictício de reabilitação', comparator: 'Cuidado usual',
    methods: 'Análise baseada apenas no abstract (fictício).',
    results: [R({ outcome: 'Distância no teste de caminhada de 6 minutos', outcomeType: 'primary', measure: 'Diferença de médias', measureKind: 'difference', estimate: 32, estimateRaw: '32', unit: 'metros', confidenceInterval: null, pValue: { raw: 'p = 0,04', operator: '=', value: 0.04 }, missingReason: 'Intervalo de confiança não reportado no abstract' })],
    implications: 'Sem IC, não é possível avaliar a precisão da estimativa.', applicability: 'Exemplo ilustrativo.',
    limitations: ['Análise baseada só no abstract.', 'IC ausente.'], rob: null, funding: null, coi: null,
    missing: [{ field: 'results[0].confidenceInterval', reason: 'not_reported_in_available_material' }, { field: 'methods', reason: 'requires_full_text' }],
  },
  {
    code: 'DEMO-009', topics: ['hipertensao-arterial', 'diabetes'], edition: 'none', status: 'in_review',
    title: 'DEMO-009 — Fictitious pending analysis for editorial-review demonstration',
    headline: 'Análise fictícia usada para demonstrar a revisão editorial',
    design: 'cohort', pubTypes: ['Observational Study'], daysAgo: 0, priority: 0.55,
    summary: 'Análise fictícia que entra na fila editorial para demonstrar aprovação, rejeição e trilha de auditoria. Não é pesquisa real.',
    inShort: 'Item de teste para o fluxo de revisão.',
    context: 'Demonstração.', objective: 'Demonstrar revisão editorial.', population: 'Fictícia.', sampleSize: 900, followUp: null, intervention: null, comparator: null,
    methods: 'Fictício.', results: [R({ outcome: 'Desfecho fictício', outcomeType: 'primary', measure: 'OR', measureKind: 'ratio', estimate: 1.2, estimateRaw: '1,2', confidenceInterval: { level: 95, lower: 0.9, upper: 1.6, raw: '0,9–1,6' }, pValue: { raw: 'p = 0,21', operator: '=', value: 0.21 } })],
    implications: 'Fictício.', applicability: 'Fictício.', limitations: ['Fictício.'], rob: null, funding: null, coi: null,
    flags: ['requires_human_review'],
  },
];
