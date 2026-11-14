/* global localStorage, document */
// Aplica o tema escolhido antes da primeira pintura (evita piscar). Arquivo próprio por causa da CSP (sem script inline).
try {
  var t = localStorage.getItem('jm:theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch {
  // armazenamento indisponível: segue o tema do sistema
}
