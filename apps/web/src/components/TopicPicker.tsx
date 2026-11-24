import { useMemo, useState } from 'react';
import type { Topic } from '@jm/contracts';
import { Check, Search, X } from 'lucide-react';

// Seletor de interesses no padrão de "chips" (Medium, Pinterest, Spotify): uma área por vez em abas, subáreas como
// cartões e temas como chips; busca atravessa tudo; os escolhidos ficam visíveis no topo e saem com um toque.
// Cada chip é um checkbox nativo escondido dentro do <label> (teclado, leitor de tela e testes continuam funcionando).

function Chip({ t, checked, onToggle, strong = false }: { t: Topic; checked: boolean; onToggle: (slug: string) => void; strong?: boolean }) {
  return (
    <label className={`topic-chip ${checked ? 'is-on' : ''} ${strong ? 'is-strong' : ''}`}>
      <input type="checkbox" className="topic-chip-input" checked={checked} onChange={() => onToggle(t.slug)} />
      {checked && <Check size={14} aria-hidden />}
      <span>{t.label}</span>
    </label>
  );
}

/** Seleção de interesses (área → subárea → tema). Só itens habilitados aparecem. */
export default function TopicPicker({ topics, value, onChange }: { topics: Topic[]; value: string[]; onChange: (v: string[]) => void }) {
  const sel = new Set(value);
  const toggle = (slug: string) => {
    const n = new Set(sel);
    if (n.has(slug)) n.delete(slug);
    else n.add(slug);
    onChange([...n]);
  };
  const enabled = useMemo(() => topics.filter((t) => t.enabled), [topics]);
  const children = (slug: string) => enabled.filter((t) => t.parentSlug === slug);
  const areas = enabled.filter((t) => t.level === 'area');
  const [area, setArea] = useState(areas[0]?.slug ?? '');
  const [q, setQ] = useState('');
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const areaOf = (t: Topic): string => (t.parentSlug ? areaOf(bySlug.get(t.parentSlug) ?? t) : t.slug);
  const countIn = (a: string) => value.filter((s) => { const t = bySlug.get(s); return t && areaOf(t) === a; }).length;

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const hits = q.trim() ? enabled.filter((t) => norm(t.label).includes(norm(q.trim()))).slice(0, 40) : [];
  const current = areas.find((a) => a.slug === area) ?? areas[0];

  return (
    <div className="grid gap-5">
      {/* Escolhidos */}
      <div className="topic-selected" aria-live="polite">
        {value.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nenhum tema escolhido ainda. Toque nos temas abaixo para seguir.</p>
        ) : (
          <>
            <p className="m-0 text-sm font-semibold">{value.length} {value.length === 1 ? 'escolhido' : 'escolhidos'}</p>
            <div className="flex flex-wrap gap-1.5">
              {value.map((s) => bySlug.get(s)).filter(Boolean).map((t) => (
                <button key={t!.slug} type="button" className="topic-chip is-on" onClick={() => toggle(t!.slug)} aria-label={`Remover ${t!.label}`}>
                  {t!.label} <X size={13} aria-hidden />
                </button>
              ))}
              <button type="button" className="link text-sm" onClick={() => onChange([])}>Limpar</button>
            </div>
          </>
        )}
      </div>

      {/* Busca */}
      <label className="topic-search">
        <Search size={18} aria-hidden className="text-muted" />
        <span className="sr-only">Buscar tema</span>
        <input type="search" className="w-full bg-transparent outline-none" placeholder="Buscar tema (ex.: diabetes, endodontia, pré-natal)" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {q.trim() ? (
        <div className="grid gap-2">
          <p className="m-0 text-sm text-muted">{hits.length ? `${hits.length} resultado${hits.length > 1 ? 's' : ''}` : 'Nenhum tema encontrado.'}</p>
          <div className="flex flex-wrap gap-2">{hits.map((t) => <Chip key={t.slug} t={t} checked={sel.has(t.slug)} onToggle={toggle} />)}</div>
        </div>
      ) : (
        <>
          {/* Áreas em abas */}
          <div role="tablist" aria-label="Áreas" className="topic-tabs scroll-x">
            {areas.map((a) => {
              const n = countIn(a.slug);
              return (
                <button key={a.slug} type="button" role="tab" aria-selected={current?.slug === a.slug} onClick={() => setArea(a.slug)}>
                  {a.label}{n > 0 && <span className="topic-count tnum">{n}</span>}
                </button>
              );
            })}
          </div>

          {current && (
            <div role="tabpanel" aria-label={current.label} className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-sm text-muted">Siga a área inteira ou escolha só o que interessa.</p>
                <Chip t={current} checked={sel.has(current.slug)} onToggle={toggle} strong />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {children(current.slug).map((s) => (
                  <div key={s.slug} className={`topic-card ${sel.has(s.slug) ? 'is-on' : ''}`}>
                    <Chip t={s} checked={sel.has(s.slug)} onToggle={toggle} strong />
                    {children(s.slug).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">{children(s.slug).map((t) => <Chip key={t.slug} t={t} checked={sel.has(t.slug)} onToggle={toggle} />)}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
