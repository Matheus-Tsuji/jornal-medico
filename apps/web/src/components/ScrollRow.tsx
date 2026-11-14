import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Linha com rolagem horizontal que mostra que há mais conteúdo: esmaecimento nas bordas e setas
 * (só aparecem do lado onde ainda há itens). O item ativo é trazido para a vista ao trocar de página.
 */
export default function ScrollRow({ children, className = '', label = 'seções' }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const loc = useLocation();

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update); // itens chegam depois (taxonomia vem da API)
    mo.observe(el, { childList: true, subtree: true });
    update();
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [update]);

  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [loc.pathname]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: reduce ? 'auto' : 'smooth' });
  };

  const arrow = 'absolute top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-ink shadow-sm hover:border-ink';
  return (
    <div className="relative">
      {edges.left && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-14 bg-linear-to-r from-paper to-transparent" />
          <button type="button" className={`${arrow} left-1`} onClick={() => scrollBy(-1)} aria-label={`Ver ${label} anteriores`}>
            <ChevronLeft size={18} aria-hidden />
          </button>
        </>
      )}
      <div ref={ref} className={`scroll-x ${className}`}>{children}</div>
      {edges.right && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-14 bg-linear-to-l from-paper to-transparent" />
          <button type="button" className={`${arrow} right-1`} onClick={() => scrollBy(1)} aria-label={`Ver mais ${label}`}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
