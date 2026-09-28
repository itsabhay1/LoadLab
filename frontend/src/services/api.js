import { z } from 'zod';

const API_PREFIX = '/api/v1';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
let accessToken;
let unauthorizedHandler;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized() {
  unauthorizedHandler?.();
}
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
const userSchema = z.object({ id: z.string(), name: z.string(), email: z.email() });
const authSchema = z.object({ accessToken: z.string().min(1), user: userSchema });
const targetSchema = z
  .object({
    _id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    hostname: z.string(),
    verificationToken: z.string(),
    verificationUrl: z.string(),
    status: z.enum(['PENDING', 'VERIFIED']),
    verifiedAt: z.string().optional().nullable(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
const planSchema = z
  .object({
    _id: z.string(),
    name: z.string(),
    targetMode: z.enum(['LOCAL', 'EXTERNAL']).optional(),
    target: z.string().optional().nullable(),
    endpointPath: z.string().optional().nullable(),
    targetUrl: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    requestBody: z.any().optional(),
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
  getToken = getAccessToken,
  setToken = setAccessToken,
  onUnauthorized = notifyUnauthorized,
} = {}) {
  let refreshPromise;
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

  async function request(
    path,
    {
      signal,
      schema,
      method = 'GET',
      body,
      credentials,
      authenticated = true,
      retryAccessToken = true,
    } = {},
    retried = false,
  ) {
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
      const token = authenticated ? getToken?.() : undefined;
      const response = await fetchImpl(`${base}${API_PREFIX}${path}`, {
        method,
        ...(credentials ? { credentials } : {}),
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
        const errorCode = data?.error?.code ?? 'HTTP_ERROR';
        if (
          response.status === 401 &&
          errorCode === 'TOKEN_EXPIRED' &&
          token &&
          retryAccessToken &&
          !retried
        ) {
          try {
            if (getToken?.() === token) await refreshSession();
            if (!getToken?.()) throw new Error('Refresh did not return an access token.');
            return request(
              path,
              { signal, schema, method, body, credentials, authenticated, retryAccessToken },
              true,
            );
          } catch (refreshError) {
            setToken?.(undefined);
            onUnauthorized?.();
            throw refreshError;
          }
        }
        if (response.status === 401 && token && authenticated) {
          setToken?.(undefined);
          onUnauthorized?.();
        }
        const safeMessages = {
          INVALID_CREDENTIALS: 'Email or password is incorrect.',
          EMAIL_EXISTS: 'An account with this email already exists.',
          ACCOUNT_METHOD_CONFLICT:
            'An account with this email already exists. Sign in using its existing method.',
          TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
          AUTH_REQUIRED: 'Please sign in to continue.',
          INVALID_TOKEN: 'Your session is invalid. Please sign in again.',
          USER_UNAVAILABLE: 'Your account is unavailable.',
          GOOGLE_TOKEN_INVALID: 'Google authentication could not be verified.',
          GOOGLE_EMAIL_UNVERIFIED: 'The Google email is not verified.',
          GOOGLE_NOT_CONFIGURED: 'Google Sign-In is not configured.',
          AUTH_RATE_LIMITED: 'Too many authentication attempts. Try again later.',
          REFRESH_REQUIRED: 'No refresh session is available.',
          REFRESH_EXPIRED: 'Your refresh session has expired.',
          INVALID_REFRESH_TOKEN: 'Your refresh session is invalid.',
          TARGET_EXISTS: 'This target is already in your account.',
          TARGET_NOT_FOUND: 'Target was not found.',
          TARGET_NOT_VERIFIED: 'Select a verified target owned by your account.',
          TARGET_UNAVAILABLE: 'The verified target is no longer available.',
          TARGET_NO_LONGER_ELIGIBLE: 'The target no longer passes safety validation.',
          LOCAL_TARGET_DISABLED: 'Local test mode is not available in production.',
          TARGET_FORBIDDEN: 'The target destination is not allowed.',
          TARGET_PRIVATE_ADDRESS: 'Targets resolving to private or local addresses are blocked.',
          TARGET_DNS_FAILED: 'The target hostname could not be resolved.',
          TARGET_TIMEOUT: 'The verification request timed out.',
          VERIFICATION_UNAVAILABLE: 'The verification endpoint could not be reached.',
          VERIFICATION_MISMATCH: 'The verification token did not match.',
          UNSAFE_REDIRECT: 'The verification redirect was rejected.',
          UNSAFE_PROTOCOL: 'Only HTTP and HTTPS targets are supported.',
          INVALID_TARGET_URL: 'Enter an HTTP(S) origin without a path or custom port.',
          INVALID_ENDPOINT_PATH: 'The endpoint path cannot change the verified hostname.',
          INVALID_HEADERS: 'One or more request headers are not allowed.',
          INVALID_REQUEST_BODY: 'The JSON request body is invalid or too large.',
          UNSUPPORTED_METHOD: 'The HTTP method is not supported.',
          VALIDATION_ERROR: 'Please check the information you entered.',
        };
        throw new ApiError(
          safeMessages[errorCode] ??
            (response.status === 503
              ? 'Database unavailable or service shutting down.'
              : `API request failed (HTTP ${response.status}).`),
          {
            status: response.status,
            code: errorCode,
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

  function refreshSession(options = {}) {
    if (!refreshPromise) {
      refreshPromise = request('/auth/refresh', {
        ...options,
        method: 'POST',
        credentials: 'include',
        authenticated: false,
        retryAccessToken: false,
        schema: authSchema,
      })
        .then((response) => {
          setToken?.(response.accessToken);
          return response;
        })
        .finally(() => {
          refreshPromise = undefined;
        });
    }
    return refreshPromise;
  }

  return {
    request,
    health: (options) =>
      request('/health', { ...options, authenticated: false, schema: healthSchema }),
    ready: (options) =>
      request('/ready', { ...options, authenticated: false, schema: readinessSchema }),
    register: (credentials, options) =>
      request('/auth/register', {
        ...options,
        method: 'POST',
        credentials: 'include',
        authenticated: false,
        retryAccessToken: false,
        body: credentials,
        schema: authSchema,
      }),
    login: (credentials, options) =>
      request('/auth/login', {
        ...options,
        method: 'POST',
        credentials: 'include',
        authenticated: false,
        retryAccessToken: false,
        body: credentials,
        schema: authSchema,
      }),
    googleLogin: (credential, options) =>
      request('/auth/google', {
        ...options,
        method: 'POST',
        credentials: 'include',
        authenticated: false,
        retryAccessToken: false,
        body: { credential },
        schema: authSchema,
      }),
    refresh: (options) => refreshSession(options),
    logout: (options) =>
      request('/auth/logout', {
        ...options,
        method: 'POST',
        credentials: 'include',
        authenticated: false,
        retryAccessToken: false,
      }),
    me: (options) => request('/auth/me', { ...options, schema: z.object({ user: userSchema }) }),
    listTargets: (options) =>
      request('/targets', { ...options, schema: z.object({ targets: z.array(targetSchema) }) }),
    getTarget: (targetId, options) =>
      request(`/targets/${targetId}`, { ...options, schema: z.object({ target: targetSchema }) }),
    createTarget: (target, options) =>
      request('/targets', {
        ...options,
        method: 'POST',
        body: target,
        schema: z.object({ target: targetSchema }),
      }),
    verifyTarget: (targetId, options) =>
      request(`/targets/${targetId}/verify`, {
        ...options,
        method: 'POST',
        schema: z.object({ target: targetSchema }),
      }),
    deleteTarget: (targetId, options) =>
      request(`/targets/${targetId}`, { ...options, method: 'DELETE' }),
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
