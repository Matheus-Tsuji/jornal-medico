// Congressos médicos no Brasil. Lista curada à mão (ainda sem backend), só com datas confirmadas em fonte pública.
// Conferida em 2026-11-18. Data ou local não divulgado aparece como "a confirmar", nunca estimado.
import { CalendarDays, ExternalLink, MapPin } from 'lucide-react';

type Congresso = { nome: string; area: string; inicio: string; fim: string; local: string | null; site: string; fonte: string };

const CONGRESSOS: Congresso[] = [
  { nome: 'Congresso Brasileiro do Sono 2026', area: 'Neurologia', inicio: '2026-12-02', fim: '2026-12-05', local: 'São Paulo (SP)', site: 'https://sono2026.com.br/', fonte: 'agrupamed.com.br/congressos' },
  { nome: '29º Congresso Brasileiro de Cardiopatias Congênitas, Cardiologia Pediátrica, Intervenção e Cirurgia Cardíaca Pediátrica', area: 'Cardiologia', inicio: '2027-04-07', fim: '2027-04-10', local: 'Recife (PE)', site: 'https://sbc.iweventos.com.br/cbcccp2027', fonte: 'agrupamed.com.br/congressos' },
  { nome: 'XXII Congresso da Academia Brasileira de Neurocirurgia (CABNc)', area: 'Neurocirurgia', inicio: '2027-04-21', fim: '2027-04-24', local: 'Curitiba (PR)', site: 'https://congressoabnc2027.com.br/', fonte: 'agrupamed.com.br/congressos' },
  { nome: '64º Congresso Brasileiro de Ginecologia e Obstetrícia (CBGO)', area: 'Ginecologia e obstetrícia', inicio: '2027-05-12', fim: '2027-05-15', local: null, site: 'https://cbgo2027.com.br/', fonte: 'tivita.com/conteudos/agenda-congressos-saude-2027' },
  { nome: 'XX Congresso Brasileiro de Transplantes', area: 'Transplantes', inicio: '2027-09-22', fim: '2027-09-25', local: 'Belo Horizonte (MG)', site: 'https://site.abto.org.br/en/xx-congresso-brasileiro-de-transplantes-2027/', fonte: 'agrupamed.com.br/congressos' },
  { nome: '41º Congresso Brasileiro de Urologia (SBU)', area: 'Urologia', inicio: '2027-11-20', fim: '2027-11-23', local: 'Rio de Janeiro (RJ)', site: 'https://portaldaurologia.org.br/', fonte: 'agenciadomedico.com.br/congressos-medicos-2027' },
];

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts }).format(new Date(`${d}T00:00:00Z`));

export default function Congressos() {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const proximos = CONGRESSOS.filter((c) => c.fim >= hoje).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const porMes = new Map<string, Congresso[]>();
  for (const c of proximos) {
    const mes = fmt(c.inicio, { month: 'long', year: 'numeric' });
    porMes.set(mes, [...(porMes.get(mes) ?? []), c]);
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <p className="kicker m-0 text-muted">Agenda</p>
      <h1 className="m-0 font-serif text-4xl font-bold">Congressos</h1>
      <p className="mt-2 text-muted">Congressos médicos no Brasil com data confirmada. Confira sempre no site oficial antes de se inscrever ou viajar.</p>
      {[...porMes].map(([mes, lista]) => (
        <section key={mes} className="rule-strong mt-6 pt-3" aria-label={mes}>
          <h2 className="kicker m-0 mb-3 text-ink first-letter:uppercase">{mes}</h2>
          <ul className="m-0 grid list-none gap-3 p-0">
            {lista.map((c) => (
              <li key={c.nome} className="congress-card grid gap-3 sm:grid-cols-[5.5rem_1fr]">
                <div className="congress-date tnum" aria-hidden>
                  <span className="text-2xl font-bold leading-none">{fmt(c.inicio, { day: '2-digit' })}–{fmt(c.fim, { day: '2-digit' })}</span>
                  <span className="text-xs uppercase text-muted">{fmt(c.inicio, { month: 'short' }).replace('.', '')}</span>
                </div>
                <div className="grid gap-1.5">
                  <p className="kicker m-0 text-primary">{c.area}</p>
                  <h3 className="m-0 font-serif text-lg font-bold leading-snug">{c.nome}</h3>
                  <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span className="inline-flex items-center gap-1"><CalendarDays size={14} aria-hidden />{fmt(c.inicio, { day: 'numeric', month: 'long' })} a {fmt(c.fim, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                    <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden />{c.local ?? 'Local a confirmar'}</span>
                  </p>
                  <p className="m-0 flex flex-wrap items-center gap-x-4 text-sm">
                    <a href={c.site} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">Site oficial <ExternalLink size={13} aria-hidden /></a>
                    <span className="text-xs text-muted">Data conferida em {c.fonte}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="rule-top mt-8 pt-4 text-sm text-muted">Lista conferida em 18 de novembro de 2026. Congressos como o Brasileiro de Cardiologia e o de Medicina Intensiva de 2027 ainda não divulgaram data e entram quando forem confirmados.</p>
    </div>
  );
}
