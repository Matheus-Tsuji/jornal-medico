import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Source } from '@jm/contracts';
import { api, useMe, useTopics } from '../lib/api';
import TopicPicker from '../components/TopicPicker';
import { Loading, PageTitle } from '../components/ui';

export default function Configuracoes() {
  const me = useMe();
  const topics = useTopics();
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<Source[]>('/sources') });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sel, setSel] = useState<string[]>([]);
  const [srcSel, setSrcSel] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (me.data) { setSel(me.data.preferences.topics); setSrcSel(me.data.preferences.sources); }
  }, [me.data]);

  const savePrefs = useMutation({
    mutationFn: () => api('/me/preferences', { method: 'PATCH', body: { topics: sel, sources: srcSel } }),
    onSuccess: () => { setMsg('Interesses salvos.'); qc.invalidateQueries(); },
  });
  const personalization = useMutation({
    mutationFn: (v: boolean) => api('/me', { method: 'PATCH', body: { personalizationEnabled: v } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const clearHistory = useMutation({ mutationFn: () => api('/me/history', { method: 'DELETE' }), onSuccess: () => { setMsg('Histórico e sinais de leitura apagados.'); qc.invalidateQueries(); } });
  const logoutAll = useMutation({ mutationFn: () => api('/auth/logout-all', { method: 'POST' }), onSuccess: () => { qc.clear(); nav('/entrar'); } });
  const del = useMutation({ mutationFn: () => api('/me', { method: 'DELETE', body: { confirm: 'EXCLUIR' } }), onSuccess: () => { qc.clear(); nav('/'); } });

  if (me.isLoading || topics.isLoading) return <div className="mx-auto max-w-4xl px-4"><Loading /></div>;
  if (!me.data) return <Navigate to="/entrar" replace />;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10">
      <PageTitle kicker="Conta" title="Preferências" />
      {me.data.isGuest && (
        <p className="border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm">
          Você está como <strong>visitante</strong>: tudo fica ligado a este navegador. <Link to="/entrar" className="link">Guardar com meu e-mail</Link> para não perder seus interesses e salvos.
        </p>
      )}
      {msg && <p role="status" className="border-l-4 border-primary bg-primary-soft px-3 py-2 text-sm">{msg}</p>}

      <section aria-labelledby="int" className="py-4">
        <h2 id="int" className="m-0 mb-3 font-serif text-2xl font-bold">Temas que você segue</h2>
        {topics.data && <TopicPicker topics={topics.data} value={sel} onChange={setSel} />}
        <h3 className="kicker mt-6 mb-2">Fontes seguidas</h3>
        <div className="flex flex-wrap gap-3">
          {(sources.data ?? []).filter((s) => s.enabled).map((s) => (
            <label key={s.slug} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-5" checked={srcSel.includes(s.slug)} onChange={() => setSrcSel(srcSel.includes(s.slug) ? srcSel.filter((x) => x !== s.slug) : [...srcSel, s.slug])} /> {s.name}
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary mt-4" onClick={() => savePrefs.mutate()} disabled={savePrefs.isPending}>Salvar interesses</button>
      </section>

      <section aria-labelledby="pers" className="rule-top py-6">
        <h2 id="pers" className="m-0 mb-2 font-serif text-2xl font-bold">Personalização</h2>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5" checked={me.data.personalizationEnabled} onChange={(e) => personalization.mutate(e.target.checked)} />
          Usar meus interesses e leituras para ordenar “Para você”
        </label>
        <p className="m-0 text-sm text-muted">Desligado, você recebe a seleção geral. A capa editorial é a mesma para todos. Não inferimos condições de saúde e não compartilhamos sinais de leitura com terceiros.</p>
      </section>

      <section aria-labelledby="dados" className="rule-top py-6">
        <h2 id="dados" className="m-0 mb-3 font-serif text-2xl font-bold">Seus dados</h2>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-ghost" href="/api/v1/me/export" download>Exportar meus dados (JSON)</a>
          <button type="button" className="btn btn-ghost" onClick={() => clearHistory.mutate()}>Apagar histórico e sinais</button>
          <button type="button" className="btn btn-ghost" onClick={() => logoutAll.mutate()}>Encerrar todas as sessões</button>
        </div>
        {me.data.role === 'reader' && (
          <form className="mt-6 grid max-w-md gap-2 border border-danger p-4" onSubmit={(e) => { e.preventDefault(); del.mutate(); }}>
            <h3 className="m-0 text-base font-bold text-danger">Excluir conta</h3>
            <p className="m-0 text-sm">Apaga sua conta, preferências, salvos e histórico. Não pode ser desfeito. Digite <strong>EXCLUIR</strong> para confirmar.</p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirmação" />
            <button className="btn btn-danger" disabled={confirm !== 'EXCLUIR' || del.isPending}>Excluir minha conta</button>
          </form>
        )}
      </section>
      <p className="rule-top pt-4 text-sm"><Link to="/privacidade" className="link">Privacidade e termos</Link> · <Link to="/assinatura" className="link">Assinatura</Link> · Suporte: <span className="text-muted">canal a definir [pendente]</span></p>
    </div>
  );
}
