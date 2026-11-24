import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { professionalProfiles } from '@jm/contracts';
import { api, useMe, useTopics } from '../lib/api';
import TopicPicker from '../components/TopicPicker';
import { Loading } from '../components/ui';

const STEPS = ['Boas-vindas', 'Interesses', 'Revisão'];
const profileLabel: Record<string, string> = { medico: 'Médico(a)', residente: 'Residente', estudante: 'Estudante', outro: 'Outro' };

export default function BoasVindas() {
  const me = useMe();
  const topics = useTopics();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  useEffect(() => {
    if (me.data) {
      setSel(me.data.preferences.topics);
      setProfile(me.data.profile);
    }
  }, [me.data]);

  const finish = useMutation({
    mutationFn: async (skip: boolean) => {
      if (!skip) await api('/me/preferences', { method: 'PATCH', body: { topics: sel, sources: [] } });
      await api('/me', { method: 'PATCH', body: { onboarded: true, ...(skip ? {} : { profile }) } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      nav('/jornal');
    },
  });

  if (me.isLoading || topics.isLoading) return <div className="mx-auto max-w-3xl px-4"><Loading /></div>;
  if (!me.data) return <Navigate to="/entrar" replace />;
  const all = topics.data ?? [];
  const bySlug = new Map(all.map((t) => [t.slug, t]));
  const areaOf = (slug: string): string => { const t = bySlug.get(slug); return t?.parentSlug ? areaOf(t.parentSlug) : (t?.label ?? ''); };
  const groups = [...sel.reduce((m, slug) => {
    const t = bySlug.get(slug);
    if (!t) return m;
    const k = areaOf(slug);
    m.set(k, [...(m.get(k) ?? []), t.level === 'area' ? `Toda a área` : t.label]);
    return m;
  }, new Map<string, string[]>())].map(([area, items]) => ({ area, items }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <nav aria-label="Progresso" className="mb-8 grid gap-2">
        <p className="m-0 text-xs font-semibold tracking-wider text-muted uppercase">Etapa {step + 1} de {STEPS.length} · {STEPS[step]}</p>
        <ol className="onb-steps">
          {STEPS.map((st, i) => <li key={st} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'is-done' : ''}><span className="sr-only">{i + 1}. {st}</span></li>)}
        </ol>
      </nav>

      {step === 0 && (
        <section className="grid gap-4">
          <h1 className="m-0 font-serif text-4xl font-bold tracking-tight">Seu jornal médico diário</h1>
          <p className="m-0 font-serif text-xl leading-relaxed">Todo dia às 6h, uma edição curta com os estudos que valem a sua atenção, em português, com os números como foram publicados.</p>
          <div className="rule-top grid gap-4 pt-4 sm:grid-cols-3">
            {[
              ['Capa', 'A manchete é o estudo de maior interesse do dia; abaixo, as seções por área.'],
              ['Leitura rápida', '“Em poucas palavras” e o resultado principal com intervalo de confiança.'],
              ['Análise aprofundada', 'Métodos, todos os resultados, limitações e de onde saiu cada número.'],
            ].map(([t, d]) => <div key={t}><h2 className="kicker m-0 mb-1">{t}</h2><p className="m-0 text-sm text-muted">{d}</p></div>)}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>Escolher meus interesses</button>
            <button type="button" className="btn btn-ghost" onClick={() => finish.mutate(true)}>Concluir depois</button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="grid gap-4">
          <h1 className="m-0 font-serif text-3xl font-bold">O que você quer acompanhar?</h1>
          <p className="m-0 text-muted">Escolha áreas, subáreas ou temas. Isso só muda a ordem da sua seleção pessoal; a capa editorial continua igual para todos. Não informe condições de saúde pessoais aqui.</p>
          {topics.data && <TopicPicker topics={topics.data} value={sel} onChange={setSel} />}
          <fieldset className="m-0 border-0 border-t border-line p-0 pt-4">
            <legend className="text-sm font-semibold">Perfil profissional (opcional)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {professionalProfiles.map((p) => (
                <label key={p} className={`btn ${profile === p ? 'btn-primary' : 'btn-ghost'}`}>
                  <input type="radio" name="perfil" className="sr-only" checked={profile === p} onChange={() => setProfile(p)} />{profileLabel[p]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>Voltar</button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Revisar{sel.length ? ` (${sel.length})` : ''}</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="grid gap-5">
          <h1 className="m-0 font-serif text-3xl font-bold">Tudo certo?</h1>
          {groups.length ? (
            <div className="grid gap-3">
              <p className="m-0 text-muted">Sua capa vai priorizar estes temas:</p>
              {groups.map((g) => (
                <div key={g.area} className="topic-card">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="m-0 font-serif text-lg font-bold">{g.area}</p>
                    <span className="tnum text-xs text-muted">{g.items.length} {g.items.length === 1 ? 'tema' : 'temas'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">{g.items.map((l) => <span key={l} className="topic-chip is-on !cursor-default">{l}</span>)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 rounded-xl border border-dashed border-line p-4">Você não escolheu interesses: verá a seleção geral. Dá para escolher a qualquer momento.</p>
          )}
          {profile && <p className="m-0 text-sm">Perfil: <strong>{profileLabel[profile]}</strong></p>}
          <p className="m-0 text-sm text-muted">Dá para alterar tudo depois em <Link to="/configuracoes" className="link">Preferências</Link>.</p>
          {finish.error && <p role="alert" className="text-danger">{(finish.error as Error).message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Editar escolhas</button>
            <button type="button" className="btn btn-primary" disabled={finish.isPending} onClick={() => finish.mutate(false)}>Abrir a edição de hoje</button>
          </div>
        </section>
      )}
    </div>
  );
}
