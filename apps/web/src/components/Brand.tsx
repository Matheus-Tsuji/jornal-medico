// Identidade provisória "Selo Vinho": selo circular com JM e ponto dourado, título em EB Garamond.
// Cores via currentColor/variáveis para funcionar nos temas claro e escuro.
import { useId } from 'react';

export function Seal({ size = 56, className = '', label = 'Selo do Jornal Médico' }: { size?: number; className?: string; label?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label} className={`shrink-0 text-primary ${className}`}>
      <defs>
        <path id={`seal-${id}`} d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" />
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
      <text fontFamily="EB Garamond, serif" fontSize="8.5" fontWeight="600" fill="currentColor" letterSpacing="1">
        <textPath href={`#seal-${id}`} textLength="228" lengthAdjust="spacing">JORNAL MÉDICO · PESQUISA E PRÁTICA ·</textPath>
      </text>
      <text x="50" y="59" textAnchor="middle" fontFamily="EB Garamond, serif" fontSize="26" fontWeight="600" fill="currentColor">JM</text>
      <circle cx="50" cy="66" r="1.8" fill="var(--color-gold)" />
    </svg>
  );
}

/** Versão compacta (anel + JM), para cabeçalho encolhido e tamanhos pequenos. */
export function SealMini({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="shrink-0 text-primary">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="4" />
      <text x="50" y="62" textAnchor="middle" fontFamily="EB Garamond, serif" fontSize="40" fontWeight="600" fill="currentColor">JM</text>
      <circle cx="50" cy="73" r="3" fill="var(--color-gold)" />
    </svg>
  );
}

export function Wordmark({ name, size = 'lg', tagline = true }: { name: string; size?: 'sm' | 'lg' | 'xl'; tagline?: boolean }) {
  const fs = size === 'xl' ? 'text-5xl sm:text-7xl' : size === 'lg' ? 'text-4xl sm:text-6xl' : 'text-2xl';
  return (
    <span className="inline-grid justify-items-start gap-1.5">
      <span className={`font-serif leading-none font-medium tracking-tight text-primary ${fs}`}>{name}</span>
      {tagline && (
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="h-px w-8 bg-gold sm:w-10" />
          <span className="text-[0.62rem] font-semibold tracking-[0.3em] text-accent uppercase sm:text-xs">Pesquisa e prática</span>
        </span>
      )}
    </span>
  );
}

/** Bloco IN/DI vetorial da marca Indi (desenhado à mão no canvas "Indi branding"). Claro: vinho cheio; escuro: só contorno. */
export function IndiMark({ height = 76, className = '' }: { height?: number; className?: string }) {
  const I = 'M0,0H37V4H27V96H37V100H0V96H10V4H0Z';
  return (
    <svg viewBox="0 0 206 293" style={{ height, width: 'auto' }} className={`indi-mark block ${className}`} aria-hidden="true">
      <rect x="2" y="2" width="202" height="289" className="indi-mark-bg" strokeWidth="4" />
      <g className="indi-mark-fg">
        <g transform="translate(36 36)">
          <path d={I} />
          <g transform="translate(40 0)">
            <rect x="10" y="0" width="5" height="100" /><rect x="0" y="0" width="28" height="4" /><rect x="0" y="96" width="25" height="4" />
            <polygon points="10,0 28,0 84,100 66,100" />
            <rect x="79" y="0" width="5" height="100" /><rect x="69" y="0" width="25" height="4" />
          </g>
        </g>
        <g transform="translate(36 157)">
          <path fillRule="evenodd" d="M0,0H45C78,0 94,22 94,50C94,78 78,100 45,100H0V96H10V4H0Z M27,4H44C66,4 76,24 76,50C76,76 66,96 44,96H27Z" />
          <path transform="translate(97 0)" d={I} />
        </g>
      </g>
    </svg>
  );
}

/** Logo completo: bloco IN/DI + "Index Discovery" rente à base. */
export function IndiLogo({ height = 76 }: { height?: number }) {
  return (
    <span className="flex items-end gap-3">
      <IndiMark height={height} />
      <span className="flex flex-col gap-1 text-sm leading-none font-medium tracking-tight text-ink"><span>Index</span><span>Discovery</span></span>
    </span>
  );
}
