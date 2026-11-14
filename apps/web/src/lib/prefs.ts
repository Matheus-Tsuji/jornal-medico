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

export function useReadingPrefs() {
  const [scale, setScale] = useState(() => read('jm:fs', '1'));
  const [quick, setQuick] = useState(() => read('jm:quick', '0') === '1');
  useEffect(() => {
    document.documentElement.style.setProperty('--fs-scale', scale);
    write('jm:fs', scale);
  }, [scale]);
  useEffect(() => { write('jm:quick', quick ? '1' : '0'); }, [quick]);
  // Tema: sistema (padrão) → claro → escuro. 'system' remove o atributo e segue prefers-color-scheme.
  const [theme, setTheme] = useState<Theme>(() => (read('jm:theme', 'system') as Theme));
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    write('jm:theme', theme);
  }, [theme]);
  return {
    theme,
    cycleTheme: () => setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]!),
    scale,
    cycleScale: () => setScale((s) => SCALES[(SCALES.indexOf(s) + 1) % SCALES.length]!),
    quick,
    toggleQuick: () => setQuick((q) => !q),
  };
}
