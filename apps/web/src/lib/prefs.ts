// Conveniências de leitura por leitor (tamanho da fonte, leitura rápida). Só localStorage, com fallback.
import { useEffect, useState } from 'react';

const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* modo privado: segue sem persistir */
  }
};

const SCALES = ['1', '1.125', '1.25'];
export type Theme = 'system' | 'light' | 'dark';
const THEMES: Theme[] = ['system', 'light', 'dark'];

/** 'system' remove o atributo e segue prefers-color-scheme. */
function applyTheme(theme: Theme) {
  const el = document.documentElement;
  if (theme === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', theme);
}

export function useReadingPrefs() {
  const [scale, setScale] = useState(() => read('jm:fs', '1'));
  // ponytail: o botão "Leitura rápida" saiu do topo (2026-11-16); começa desligado para ninguém ficar preso nele.
  const [quick, setQuick] = useState(false);
  useEffect(() => {
    document.documentElement.style.setProperty('--fs-scale', scale);
    write('jm:fs', scale);
  }, [scale]);
  useEffect(() => { write('jm:quick', quick ? '1' : '0'); }, [quick]);
  // Tema: sistema (padrão) → claro → escuro. 'system' remove o atributo e segue prefers-color-scheme.
  const [theme, setTheme] = useState<Theme>(() => (read('jm:theme', 'system') as Theme));
  useEffect(() => {
    applyTheme(theme);
    write('jm:theme', theme);
  }, [theme]);
  return {
    theme,
    // Troca de tema com transição (View Transitions API: cross-fade suave; sem suporte ou com movimento reduzido, troca direto).
    cycleTheme: () => {
      const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTheme(next);
      doc.startViewTransition(() => applyTheme(next));
      setTheme(next);
    },
    scale,
    cycleScale: () => setScale((s) => SCALES[(SCALES.indexOf(s) + 1) % SCALES.length]!),
    quick,
    toggleQuick: () => setQuick((q) => !q),
  };
}
