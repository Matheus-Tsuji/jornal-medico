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
  const labels = (topics.data ?? []).filter((t) => sel.includes(t.slug)).map((t) => t.label);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <ol className="m-0 mb-6 flex list-none gap-4 p-0 text-sm" aria-label="Progresso">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={`border-t-2 pt-1 ${i <= step ? 'border-ink font-semibold' : 'border-line text-muted'}`}>{i + 1}. {s}</li>
        ))}
      </ol>

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
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Revisar</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="grid gap-4">
          <h1 className="m-0 font-serif text-3xl font-bold">Tudo certo?</h1>
          <p className="m-0">{labels.length ? <>Você vai acompanhar: <strong>{labels.join(', ')}</strong>.</> : 'Você não escolheu interesses: verá a seleção geral, que pode mudar quando quiser.'}</p>
          <p className="m-0 text-sm text-muted">Dá para alterar tudo depois em <Link to="/configuracoes" className="link">Preferências</Link>.</p>
          {finish.error && <p role="alert" className="text-danger">{(finish.error as Error).message}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Voltar</button>
            <button type="button" className="btn btn-primary" disabled={finish.isPending} onClick={() => finish.mutate(false)}>Abrir a edição de hoje</button>
          </div>
        </section>
      )}
    </div>
  );
}
