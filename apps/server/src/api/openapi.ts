// Documento OpenAPI 3.1 gerado das rotas registradas + schemas zod de entrada.
import { z } from 'zod';
import * as c from '@jm/contracts';

const bodies: Record<string, z.ZodType> = {
  'post /api/v1/auth/request-code': c.requestCodeInput,
  'post /api/v1/auth/verify-code': c.verifyCodeInput,
  'patch /api/v1/me': c.updateMeInput,
  'patch /api/v1/me/preferences': c.updatePreferencesInput,
  'post /api/v1/topics/{slug}/follow': c.followTopicInput,
  'post /api/v1/events/read': c.readEventInput,
  'post /api/v1/feedback': c.feedbackInput,
  'post /api/v1/reports': c.errorReportInput,
  'post /api/v1/billing/checkout': c.checkoutInput,
  'post /api/v1/admin/reviews/{id}/decision': c.reviewDecisionInput,
};

export function openapi(routes: { method: string; url: string }[], title: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const body = bodies[`${r.method} ${path}`];
    (paths[path] ??= {})[r.method] = {
      tags: [path.split('/')[3] ?? 'api'],
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(body, { io: 'input', unrepresentable: 'any' }) } } } } : {}),
      responses: {
        '200': { description: 'OK' },
        default: { description: 'Erro', content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } } } },
      },
      ...(r.method !== 'get' && !path.includes('/webhook/') ? { description: 'Requer cabeçalho X-Requested-With: jornal-medico (proteção CSRF).' } : {}),
    };
  }
  return { openapi: '3.1.0', info: { title: `${title} API`, version: '1.0.0' }, servers: [{ url: '/' }], paths };
}
