// Documento OpenAPI 3.1 gerado das rotas registradas + schemas zod de entrada.
import { z } from 'zod';
import * as c from '@jm/contracts';
import { officialInput } from '../modules/monitor.ts';

const bodies: Record<string, z.ZodType> = {
  'post /api/v1/admin/monitor/documents': officialInput,
  'post /api/v1/auth/request-code': c.requestCodeInput,
  'post /api/v1/auth/register': c.passwordRegisterInput,
  'post /api/v1/auth/login': c.passwordAuthInput,
  'post /api/v1/admin/ingestion/run': c.adminIngestionInput,
  'post /api/v1/admin/jobs/process': c.adminProcessJobsInput,
  'post /api/v1/admin/editions/{date}/publish': c.adminPublishEditionInput,
  'patch /api/v1/admin/reports/{id}': c.adminReportInput,
  'patch /api/v1/admin/flags/{key}': c.adminFlagInput,
  'patch /api/v1/admin/plans/{id}': c.adminPlanInput,
  'patch /api/v1/admin/users/{id}': c.adminUserInput,
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

const responses: Record<string, z.ZodType> = {
  'post /api/v1/auth/register': c.authResponseSchema,
  'post /api/v1/auth/login': c.authResponseSchema,
  'post /api/v1/auth/verify-code': c.authResponseSchema,
  'post /api/v1/auth/guest': c.authResponseSchema,
  'get /api/v1/articles': c.articleListResponse,
  'post /api/v1/admin/jobs/process': c.adminProcessJobsResponse,
};
const optionalBodies = new Set(['post /api/v1/admin/ingestion/run', 'post /api/v1/admin/jobs/process', 'post /api/v1/admin/editions/{date}/publish']);

export function openapi(routes: { method: string; url: string }[], title: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const params: { name: string | undefined; in: string; required: boolean; schema: unknown }[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const operation = `${r.method} ${path}`;
    const body = bodies[operation];
    const response = responses[operation];
    if (operation === 'get /api/v1/articles') {
      const query = z.toJSONSchema(c.articleListQuery);
      for (const [name, schema] of Object.entries(query.properties ?? {})) {
        params.push({ name, in: 'query', required: false, schema });
      }
    }
    (paths[path] ??= {})[r.method] = {
      tags: [path.split('/')[3] ?? 'api'],
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: !optionalBodies.has(operation), content: { 'application/json': { schema: z.toJSONSchema(body, { io: 'input', unrepresentable: 'any' }) } } } } : {}),
      responses: {
        '200': {
          description: 'OK',
          ...(response ? { content: { 'application/json': { schema: z.toJSONSchema(response) } } } : {}),
        },
        default: { description: 'Erro', content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } } } },
      },
      ...(r.method !== 'get' && !path.includes('/webhook/') ? { description: 'Requer cabeçalho X-Requested-With: jornal-medico (proteção CSRF).' } : {}),
    };
  }
  return { openapi: '3.1.0', info: { title: `${title} API`, version: '1.0.0' }, servers: [{ url: '/' }], paths };
}
