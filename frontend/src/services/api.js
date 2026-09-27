import { z } from 'zod';

const API_PREFIX = '/api/v1';
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

  async function get(path, { signal, schema } = {}) {
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
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
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
    get,
    health: (options) => get('/health', { ...options, schema: healthSchema }),
    ready: (options) => get('/ready', { ...options, schema: readinessSchema }),
  };
}

export const api = createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL });
