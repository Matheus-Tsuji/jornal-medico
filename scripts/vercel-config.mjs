// config.json da Build Output API (rotas + cron). Função pura para poder ser testada.
// O Helmet só cobre a função (/api, /health, /ready); o site estático recebe aqui os mesmos cabeçalhos.
export const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

export function vercelConfig(cronSchedule) {
  return {
    version: 3,
    routes: [
      { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
      { src: '^/(api/.*|health|ready)$', dest: '/api' },
      { src: '^/(.*)$', headers: SECURITY_HEADERS, continue: true },
      { handle: 'filesystem' },
      { src: '^/(.*)$', dest: '/index.html', headers: SECURITY_HEADERS },
    ],
    crons: [{ path: '/api/v1/cron/tick', schedule: cronSchedule }],
  };
}
