// Perfil de outro leitor (tela "17 · Perfil público" do Figma). Só existe para quem tornou o perfil público.
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PublicProfile } from '@jm/contracts';
import { api } from '../lib/api';
import { Loading } from '../components/ui';

const socialLabel: Record<string, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', orcid: 'ORCID', lattes: 'Lattes' };

export default function PerfilPublico() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['/profiles', id], queryFn: () => api<PublicProfile>(`/profiles/${encodeURIComponent(id)}`), retry: false });
  if (q.isLoading) return <div className="mx-auto max-w-6xl px-4"><Loading /></div>;
  if (!q.data) {
    return (
      <div className="mx-auto grid max-w-3xl gap-3 px-4 py-16 text-center">
        <h1 className="m-0 font-serif text-3xl font-bold">Perfil não encontrado</h1>
        <p className="m-0 text-muted">Este perfil não existe ou não é público.</p>
        <p className="m-0"><Link to="/jornal" className="link">Voltar para a capa</Link></p>
      </div>
    );
  }
  const p = q.data;
  const first = p.displayName.replace(/^(dr|dra)\.?\s+/i, '').split(' ')[0];
  const socials = Object.entries(p.socials).filter(([, v]) => v) as [string, string][];
  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-4 py-8">
      <div className="pf-card">
        <header className="pf-head">
          <span className="pf-avatar" aria-hidden>{p.displayName[0]!.toUpperCase()}</span>
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="m-0 font-serif text-3xl font-bold">{p.displayName}</h1>
            {p.headline && <p className="m-0 text-sm text-muted">{p.headline}</p>}
            <p className="m-0 text-xs font-semibold text-primary">Perfil público</p>
            {socials.length > 0 && (
              <p className="pf-socials">{socials.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer nofollow">{socialLabel[k] ?? k}</a>)}</p>
            )}
          </div>
        </header>
        {p.about && <section className="pf-block pf-block-soft"><h2 className="pf-block-title">Sobre {first}</h2><p className="m-0 whitespace-pre-line text-sm">{p.about}</p></section>}
        {p.education.length > 0 && <section className="pf-block"><h2 className="pf-block-title">Formação e especializações</h2><p className="m-0 text-sm">{p.education.join(' · ')}</p></section>}
        {p.certificates.length > 0 && <section className="pf-block"><h2 className="pf-block-title">Certificados</h2><ul className="pf-inline-list">{p.certificates.map((c) => <li key={c}>{c}</li>)}</ul></section>}
        {!p.about && !p.education.length && !p.certificates.length && <p className="pf-block-hint px-1">Este leitor ainda não preencheu o perfil profissional.</p>}
      </div>

      {p.interests.length > 0 && (
        <div className="pf-card">
          <section className="pf-block">
            <h2 className="pf-block-title">Áreas de interesse</h2>
            <p className="m-0 flex flex-wrap gap-2 pt-1">{p.interests.map((t, i) => <Link key={t.slug} to={`/temas/${t.slug}`} className={`pf-pill ${i === 0 ? 'pf-pill-solid' : ''}`}>{t.label}</Link>)}</p>
          </section>
        </div>
      )}

      {p.publications.length > 0 && (
        <div className="pf-card">
          <section className="pf-block">
            <h2 className="pf-block-title">Publicações externas</h2>
            <ul className="m-0 grid list-none gap-4 p-0">
              {p.publications.map((x, i) => (
                <li key={i}>
                  {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" className="font-serif text-lg font-semibold link">{x.title}</a> : <span className="font-serif text-lg font-semibold">{x.title}</span>}
                  <span className="block text-xs text-muted">{[x.venue, x.year].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 pt-2 text-xs text-muted">Informadas pelo próprio leitor; o Index Discovery não confere estas publicações.</p>
          </section>
        </div>
      )}
    </div>
  );
}
