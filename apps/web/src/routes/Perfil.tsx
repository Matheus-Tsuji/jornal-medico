// Perfil do leitor (tela 17 do Figma): identidade, perfil profissional editável no lugar (sobre, formação,
// certificados, publicações, redes), fontes, interesses, atalhos, aparência e conta.
import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Link2, LogOut } from 'lucide-react';
import { emptyProfileDetails, type ArticleCard, type Me, type ProfileDetails, type Source } from '@jm/contracts';
import { api } from '../lib/api';
import { useMe, useTopics } from '../lib/api';
import { Loading } from '../components/ui';
import type { LayoutCtx } from '../components/Layout';

const themeLabel = { system: 'Automático', light: 'Claro', dark: 'Escuro' } as const;

type Editing = null | 'about' | 'education' | 'certificates' | 'publications' | 'socials';

function Tile({ to, letter, title, hint }: { to: string; letter: string; title: string; hint: string }) {
  return (
    <Link to={to} className="pf-tile">
      <span className="pf-tile-letter" aria-hidden>{letter}</span>
      <span className="grid"><span className="font-semibold">{title}</span><span className="text-xs text-muted">{hint}</span></span>
    </Link>
  );
}

/** Bloco de seção: título, dica, conteúdo e o "+ Adicionar"/"Editar" que abre o editor no lugar. */
function Block({ title, hint, filled, onEdit, canEdit, highlight, editLabel = 'Editar', children }: {
  title: string; hint: string; filled: boolean; onEdit: () => void; canEdit: boolean; highlight?: boolean; editLabel?: string; children?: React.ReactNode;
}) {
  return (
    <section className={`pf-block ${highlight ? 'pf-block-soft' : ''}`}>
      <h2 className="pf-block-title">{title}</h2>
      {filled ? children : <p className="pf-block-hint">{hint}</p>}
      {canEdit && <button type="button" className="pf-add" onClick={onEdit}>{filled ? editLabel : '+ Adicionar'}</button>}
    </section>
  );
}

/** Editor de lista (uma linha por item). */
function ListEditor({ value, placeholder, onSave, onCancel, saving }: { value: string[]; placeholder: string; onSave: (v: string[]) => void; onCancel: () => void; saving: boolean }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <form className="pf-editor" onSubmit={(e) => { e.preventDefault(); onSave(text.split('\n').map((s) => s.trim()).filter(Boolean)); }}>
      <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Um item por linha" />
      <p className="m-0 text-xs text-muted">Um item por linha.</p>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={saving}>Salvar</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

export default function Perfil() {
  const me = useMe();
  const prefs = useOutletContext<LayoutCtx>();
  const topics = useTopics();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editing, setEditing] = useState<Editing>(null);
  const saved = useQuery({ queryKey: ['/bookmarks', me.data?.id], enabled: !!me.data, queryFn: () => api<{ items: ArticleCard[] }>('/bookmarks') });
  const history = useQuery({ queryKey: ['/history', me.data?.id], enabled: !!me.data, queryFn: () => api<{ items: ArticleCard[] }>('/history') });
  const sources = useQuery({ queryKey: ['/sources'], queryFn: () => api<Source[]>('/sources') });
  const save = useMutation({
    mutationFn: (d: ProfileDetails) => api<Me>('/me/details', { method: 'PUT', body: d }),
    onSuccess: (m) => { qc.setQueryData(['me'], m); setEditing(null); },
  });

  if (me.isLoading) return <div className="mx-auto max-w-6xl px-4"><Loading /></div>;
  // Sem sessão: perfil de visitante (tudo vazio), em vez de mandar para o login.
  const u: Me = me.data ?? { id: 'visitante', email: '', isGuest: true, role: 'reader', profile: null, displayName: null, details: emptyProfileDetails, personalizationEnabled: false, onboarded: false, entitled: false, preferences: { topics: [], sources: [] } };
  const hasSession = !!me.data;
  const canEdit = hasSession && !u.isGuest;
  const d = u.details ?? emptyProfileDetails;
  const put = (patch: Partial<ProfileDetails>) => save.mutate({ ...d, ...patch });
  const name = u.isGuest ? 'Visitante' : u.displayName || u.email.split('@')[0]!;
  const role = u.role === 'admin' ? 'Administrador' : u.role === 'editor' ? 'Editor' : u.isGuest ? 'Visitante' : 'Leitor';
  const interests = (topics.data ?? []).filter((t) => u.preferences.topics.includes(t.slug));
  const mySources = (sources.data ?? []).filter((s) => u.preferences.sources.includes(s.slug));
  const socials = Object.entries(d.socials).filter(([, v]) => v) as [string, string][];
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); qc.clear(); nav('/'); };
  const err = save.error instanceof Error ? save.error.message : null;

  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-4 py-8">
      {/* Identidade + perfil profissional */}
      <div className="pf-card">
        <header className="pf-head">
          <span className="pf-avatar" aria-hidden>{name[0]!.toUpperCase()}</span>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h1 className="m-0 font-serif text-3xl font-bold">{name}</h1>
            {d.headline && <p className="m-0 text-sm text-primary">{d.headline}</p>}
            <p className="m-0 text-sm text-muted">{u.isGuest ? 'Sessão de visitante, sem e-mail' : u.email}</p>
            <p className="m-0 text-xs text-primary">{role} · {u.entitled ? 'Assinante' : 'Plano gratuito'}</p>
            {socials.length > 0 && (
              <p className="pf-socials">{socials.map(([k, v]) => <a key={k} href={v} target="_blank" rel="noopener noreferrer">{k === 'orcid' ? 'ORCID' : k === 'linkedin' ? 'LinkedIn' : k[0]!.toUpperCase() + k.slice(1)}</a>)}</p>
            )}
            {canEdit && editing !== 'socials' && (
              <button type="button" className="pf-add inline-flex items-center gap-1" onClick={() => setEditing('socials')}><Link2 size={13} aria-hidden /> {socials.length ? 'Editar redes e especialidade' : 'Adicionar redes sociais'}</button>
            )}
          </div>
          <dl className="pf-stats tnum">
            <div><dt>Salvos</dt><dd>{saved.data?.items.length ?? 0}</dd></div>
            <div><dt>Lidos</dt><dd>{history.data?.items.length ?? 0}</dd></div>
            <div><dt>Interesses</dt><dd>{interests.length}</dd></div>
          </dl>
        </header>

        {editing === 'socials' && <SocialsEditor d={d} saving={save.isPending} onCancel={() => setEditing(null)} onSave={(p) => put(p)} />}

        {u.isGuest && (
          <p className="pf-callout">Você está como visitante. <Link to="/entrar" className="link font-semibold">Crie sua conta</Link> para montar seu perfil e guardar salvos e interesses em qualquer aparelho.</p>
        )}

        <Block title="Sobre mim" editLabel="Editar descrição" hint="Descrição profissional e áreas de interesse." filled={!!d.about} canEdit={canEdit && editing !== 'about'} onEdit={() => setEditing('about')} highlight>
          <p className="m-0 whitespace-pre-line text-sm">{d.about}</p>
        </Block>
        {editing === 'about' && <AboutEditor value={d.about ?? ''} saving={save.isPending} onCancel={() => setEditing(null)} onSave={(about) => put({ about: about || null })} />}

        <Block title="Formação e especializações" editLabel="Editar formação" hint="Formação, especialidades e áreas de atuação." filled={d.education.length > 0} canEdit={canEdit && editing !== 'education'} onEdit={() => setEditing('education')}>
          <p className="m-0 text-sm">{d.education.join(' · ')}</p>
        </Block>
        {editing === 'education' && <ListEditor value={d.education} placeholder={'Graduação em Medicina\nResidência em Clínica Médica'} saving={save.isPending} onCancel={() => setEditing(null)} onSave={(education) => put({ education })} />}

        <Block title="Certificados" editLabel="Editar certificados" hint="Cursos e certificados profissionais." filled={d.certificates.length > 0} canEdit={canEdit && editing !== 'certificates'} onEdit={() => setEditing('certificates')}>
          <ul className="pf-inline-list">{d.certificates.map((c) => <li key={c}>{c}</li>)}</ul>
        </Block>
        {editing === 'certificates' && <ListEditor value={d.certificates} placeholder="ACLS — 2025" saving={save.isPending} onCancel={() => setEditing(null)} onSave={(certificates) => put({ certificates })} />}
        {err && <p className="m-0 px-1 text-sm text-danger" role="alert">{err}</p>}
      </div>

      {/* Publicações externas */}
      <div className="pf-card">
        <Block title="Publicações externas" editLabel="Editar publicações" hint="Artigos em outras fontes, como ORCID e PubMed." filled={d.publications.length > 0} canEdit={canEdit && editing !== 'publications'} onEdit={() => setEditing('publications')}>
          <ul className="m-0 grid list-none gap-3 p-0">
            {d.publications.map((p, i) => (
              <li key={i} className="text-sm">
                {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-serif text-base font-semibold link">{p.title}</a> : <span className="font-serif text-base font-semibold">{p.title}</span>}
                <span className="block text-xs text-muted">{[p.venue, p.year].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Block>
        {editing === 'publications' && <PublicationsEditor value={d.publications} saving={save.isPending} onCancel={() => setEditing(null)} onSave={(publications) => put({ publications })} />}
      </div>

      {/* Fontes preferidas */}
      <div className="pf-card">
        <Block title="Fontes preferidas" editLabel="Editar fontes" hint="Escolha periódicos e fontes para acompanhar." filled={mySources.length > 0} canEdit={canEdit} onEdit={() => nav('/configuracoes')}>
          <p className="m-0 text-sm">{mySources.map((s) => s.name).join(' · ')}</p>
        </Block>
      </div>

      {/* Perfil público */}
      {canEdit && (
        <div className="pf-public">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={d.isPublic} disabled={save.isPending} onChange={(e) => put({ isPublic: e.target.checked })} className="mt-1" />
            <span><span className="font-semibold">Perfil público</span><span className="block text-xs text-muted">Outros leitores veem seu nome, especialidade, sobre, formação, certificados, publicações, redes e áreas de interesse. Nunca seu e-mail nem o que você lê.</span></span>
          </label>
          {d.isPublic && <Link to={`/perfil/${u.id}`} className="btn btn-ghost shrink-0"><Eye size={16} aria-hidden /> Ver como os outros veem</Link>}
        </div>
      )}

      {/* Interesses */}
      <section aria-labelledby="interesses" className="grid gap-1">
        <h2 id="interesses" className="pf-section-title">Seus interesses</h2>
        {interests.length
          ? <p className="m-0 flex flex-wrap gap-2 pt-1">{interests.map((t, i) => <Link key={t.slug} to={`/temas/${t.slug}`} className={`pf-pill ${i === 0 ? 'pf-pill-solid' : ''}`}>{t.label}</Link>)}</p>
          : <p className="m-0 text-xs text-muted">Nenhum tema escolhido. Escolha temas para personalizar sua capa.</p>}
        <Link to="/configuracoes" className="pf-add">Editar interesses</Link>
      </section>

      {/* Celular (Figma 17 · celular): um cartão só com Salvos, Histórico e os links. */}
      <div className="sm:hidden">
        <section aria-label="Atalhos" className="pf-card pf-shortcuts">
          <Link to="/salvos"><span className="font-semibold">Salvos</span><span className="text-sm text-muted">{saved.data?.items.length ?? 0} estudos guardados</span></Link>
          <Link to="/historico"><span className="font-semibold">Histórico</span><span className="text-sm text-muted">{history.data?.items.length ?? 0} {(history.data?.items.length ?? 0) === 1 ? 'leitura' : 'leituras'}</span></Link>
          <p className="m-0 text-primary"><Link to="/configuracoes" className="text-primary">Preferências</Link> · <Link to="/assinatura" className="text-primary">Assinatura</Link></p>
        </section>
      </div>
      <section aria-label="Atalhos" className="hidden gap-2 sm:grid sm:grid-cols-2">
        <Tile to="/salvos" letter="S" title="Salvos" hint={`${saved.data?.items.length ?? 0} estudos guardados`} />
        <Tile to="/historico" letter="H" title="Histórico" hint={`${history.data?.items.length ?? 0} leituras`} />
        <Tile to="/configuracoes" letter="P" title="Preferências" hint="Temas, fontes e personalização" />
        <Tile to="/assinatura" letter="A" title="Assinatura" hint={u.entitled ? 'Plano ativo' : 'Conheça os planos'} />
      </section>

      <section aria-labelledby="aparencia" className="grid gap-1">
        <h2 id="aparencia" className="pf-section-title">Aparência</h2>
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={prefs.cycleTheme} className="pf-link-btn">Tema: {themeLabel[prefs.theme]}</button>
          <span aria-hidden>·</span>
          <button type="button" onClick={prefs.cycleScale} className="pf-link-btn">Texto: {Math.round(Number(prefs.scale) * 100)}%</button>
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {u.role !== 'reader' ? <Link to="/admin" className="link">Painel editorial</Link> : <span />}
        {hasSession && <button type="button" onClick={logout} className="pf-link-btn inline-flex items-center gap-1 text-primary"><LogOut size={14} aria-hidden /> Sair</button>}
      </div>
    </div>
  );
}

function AboutEditor({ value, onSave, onCancel, saving }: { value: string; onSave: (v: string) => void; onCancel: () => void; saving: boolean }) {
  const [text, setText] = useState(value);
  return (
    <form className="pf-editor" onSubmit={(e) => { e.preventDefault(); onSave(text.trim()); }}>
      <textarea className="input" rows={4} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: clínico com foco em prevenção cardiovascular." aria-label="Sobre mim" />
      <div className="flex gap-2"><button className="btn btn-primary" disabled={saving}>Salvar</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function SocialsEditor({ d, onSave, onCancel, saving }: { d: ProfileDetails; onSave: (p: Partial<ProfileDetails>) => void; onCancel: () => void; saving: boolean }) {
  const [headline, setHeadline] = useState(d.headline ?? '');
  const [s, setS] = useState(d.socials);
  const field = (k: keyof ProfileDetails['socials'], label: string) => (
    <label className="grid gap-1 text-xs font-semibold">{label}
      <input className="input" type="url" inputMode="url" placeholder="https://" value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value.trim() || null })} />
    </label>
  );
  return (
    <form className="pf-editor" onSubmit={(e) => { e.preventDefault(); onSave({ headline: headline.trim() || null, socials: s }); }}>
      <label className="grid gap-1 text-xs font-semibold">Especialidade e foco
        <input className="input" maxLength={120} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Ex.: Cardiologia · Prevenção cardiovascular" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">{field('linkedin', 'LinkedIn')}{field('instagram', 'Instagram')}{field('orcid', 'ORCID')}{field('lattes', 'Lattes')}</div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={saving}>Salvar</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function PublicationsEditor({ value, onSave, onCancel, saving }: { value: ProfileDetails['publications']; onSave: (v: ProfileDetails['publications']) => void; onCancel: () => void; saving: boolean }) {
  const [list, setList] = useState(value.length ? value : [{ title: '', venue: null, year: null, url: null }]);
  const set = (i: number, patch: Partial<ProfileDetails['publications'][number]>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <form className="pf-editor" onSubmit={(e) => { e.preventDefault(); onSave(list.filter((p) => p.title.trim())); }}>
      {list.map((p, i) => (
        <fieldset key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[2fr_1fr_80px]">
          <legend className="sr-only">Publicação {i + 1}</legend>
          <input className="input sm:col-span-3" placeholder="Título" value={p.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="Título" />
          <input className="input" placeholder="Periódico ou fonte" value={p.venue ?? ''} onChange={(e) => set(i, { venue: e.target.value || null })} aria-label="Periódico" />
          <input className="input" type="url" placeholder="https:// (DOI, PubMed, ORCID)" value={p.url ?? ''} onChange={(e) => set(i, { url: e.target.value.trim() || null })} aria-label="Link" />
          <input className="input" type="number" min={1900} max={2100} placeholder="Ano" value={p.year ?? ''} onChange={(e) => set(i, { year: e.target.value ? Number(e.target.value) : null })} aria-label="Ano" />
          <button type="button" className="pf-add justify-self-start text-danger" onClick={() => setList(list.filter((_, j) => j !== i))}>Remover</button>
        </fieldset>
      ))}
      <button type="button" className="pf-add justify-self-start" onClick={() => setList([...list, { title: '', venue: null, year: null, url: null }])}>+ Outra publicação</button>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={saving}>Salvar</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}
