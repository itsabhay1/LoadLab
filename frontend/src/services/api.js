import { z } from 'zod';

const API_PREFIX = '/api/v1';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('loadlab-api'),
  timestamp: z.iso.datetime(),
  uptime: z.number().nonnegative(),
});
const readinessSchema = z.object({
  status: z.literal('ready'),
  checks: z.object({ database: z.literal('connected') }),
});
const planSchema = z
  .object({
    _id: z.string(),
    name: z.string(),
    targetUrl: z.string(),
    virtualUsers: z.number(),
    durationMs: z.number(),
    rampUpMs: z.number(),
    requestTimeoutMs: z.number(),
    maxConnections: z.number(),
    requestsPerSecond: z.number(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
const statusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'INTERRUPTED',
]);
const runSchema = z
  .object({
    _id: z.string(),
    plan: z.union([z.string(), z.object({ _id: z.string() }).passthrough()]),
    configurationSnapshot: z.object({ name: z.string() }).passthrough(),
    status: statusSchema,
    snapshots: z.array(
      z.object({ capturedAt: z.string(), metrics: z.record(z.string(), z.any()) }),
    ),
    finalMetrics: z.record(z.string(), z.any()).optional(),
    queuedAt: z.string(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createApiClient({
  baseUrl = '',
  timeoutMs = 7000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = baseUrl.trim().replace(/\/$/, '');
  const validBase =
    !base ||
    (() => {
      try {
        const parsed = new URL(base);
        return (
          ['http:', 'https:'].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password &&
          !parsed.search &&
          !parsed.hash
        );
      } catch {
        return false;
      }
    })();

  async function request(path, { signal, schema, method = 'GET', body } = {}) {
    if (!validBase)
      throw new ApiError(
        'VITE_API_BASE_URL must be an HTTP(S) URL without credentials, query or fragment.',
        { code: 'CONFIGURATION_ERROR' },
      );
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(`${base}${API_PREFIX}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (response.status === 204) return undefined;
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ApiError('The API returned an invalid response. Check the API base URL.', {
          status: response.status,
          code: 'INVALID_RESPONSE',
        });
      }
      if (!response.ok) {
        throw new ApiError(
          response.status === 503
            ? 'Database unavailable or service shutting down.'
            : `API request failed (HTTP ${response.status}).`,
          {
            status: response.status,
            code: data?.error?.code ?? 'HTTP_ERROR',
            requestId: response.headers.get('x-request-id') ?? data?.error?.requestId,
          },
        );
      }
      if (schema && !schema.safeParse(data).success)
        throw new ApiError('The API response did not match the expected format.', {
          code: 'INVALID_RESPONSE',
        });
      return data;
    } catch (error) {
      if (timedOut)
        throw new ApiError('The API took too long to respond. Check that the server is running.', {
          code: 'TIMEOUT',
        });
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        'Cannot reach the API. Check the server, API base URL, network and CORS configuration.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    request,
    health: (options) => request('/health', { ...options, schema: healthSchema }),
    ready: (options) => request('/ready', { ...options, schema: readinessSchema }),
    listPlans: (options) =>
      request('/plans', { ...options, schema: z.object({ plans: z.array(planSchema) }) }),
    getPlan: (planId, options) =>
      request(`/plans/${planId}`, { ...options, schema: z.object({ plan: planSchema }) }),
    createPlan: (plan, options) =>
      request('/plans', {
        ...options,
        method: 'POST',
        body: plan,
        schema: z.object({ plan: planSchema }),
      }),
    updatePlan: (planId, plan, options) =>
      request(`/plans/${planId}`, {
        ...options,
        method: 'PATCH',
        body: plan,
        schema: z.object({ plan: planSchema }),
      }),
    deletePlan: (planId, options) => request(`/plans/${planId}`, { ...options, method: 'DELETE' }),
    startRun: (planId, options) =>
      request(`/plans/${planId}/runs`, {
        ...options,
        method: 'POST',
        schema: z.object({ runId: z.string(), status: statusSchema }),
      }),
    cancelRun: (runId, options) =>
      request(`/runs/${runId}/cancel`, {
        ...options,
        method: 'POST',
        schema: z.object({ runId: z.string(), cancellationRequested: z.literal(true) }),
      }),
    getRun: (runId, options) =>
      request(`/runs/${runId}`, { ...options, schema: z.object({ run: runSchema }) }),
    listRuns: ({ planId, ...options } = {}) =>
      request(`/runs${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`, {
        ...options,
        schema: z.object({ runs: z.array(runSchema) }),
      }),
  };
}

export const api = createApiClient({ baseUrl: API_BASE_URL });
