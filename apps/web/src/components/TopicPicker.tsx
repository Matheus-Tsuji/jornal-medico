import type { Topic } from '@jm/contracts';

function Box({ t, big = false, checked, onToggle }: { t: Topic; big?: boolean; checked: boolean; onToggle: (slug: string) => void }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2.5 ${big ? 'font-serif text-lg font-bold' : ''} ${t.enabled ? '' : 'cursor-not-allowed text-muted'}`}>
      <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-primary)]" checked={checked} disabled={!t.enabled} onChange={() => onToggle(t.slug)} />
      <span>{t.label}</span>
      {!t.enabled && <span className="text-xs font-normal">em preparação</span>}
    </label>
  );
}

/** Seleção hierárquica de interesses (área → subárea → tema). Só itens habilitados são selecionáveis. */
export default function TopicPicker({ topics, value, onChange }: { topics: Topic[]; value: string[]; onChange: (v: string[]) => void }) {
  const sel = new Set(value);
  const toggle = (slug: string) => {
    const n = new Set(sel);
    if (n.has(slug)) n.delete(slug);
    else n.add(slug);
    onChange([...n]);
  };
  const children = (slug: string) => topics.filter((t) => t.parentSlug === slug);
  const areas = topics.filter((t) => t.level === 'area');
  return (
    <div className="grid gap-6">
      {areas.map((a) => (
        <fieldset key={a.slug} className="m-0 border-0 border-t-2 border-ink p-0 pt-2">
          <legend className="sr-only">{a.label}</legend>
          <Box t={a} big checked={sel.has(a.slug)} onToggle={toggle} />
          {a.enabled && (
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {children(a.slug).filter((s) => s.enabled).map((s) => (
                <div key={s.slug} className="border-l border-line pl-3">
                  <Box t={s} checked={sel.has(s.slug)} onToggle={toggle} />
                  <div className="ml-7 grid">{children(s.slug).map((t) => <Box key={t.slug} t={t} checked={sel.has(t.slug)} onToggle={toggle} />)}</div>
                </div>
              ))}
            </div>
          )}
          {a.enabled && children(a.slug).some((s) => !s.enabled) && (
            <p className="m-0 mt-2 text-xs text-muted">Em preparação: {children(a.slug).filter((s) => !s.enabled).map((s) => s.label).join(', ')}.</p>
          )}
        </fieldset>
      ))}
    </div>
  );
}
