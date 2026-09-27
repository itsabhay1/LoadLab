import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api';

afterEach(() => vi.useRealTimers());
describe('API client', () => {
  it('uses the configured base URL and validates successful responses', async () => {
    const data = {
      status: 'ok',
      service: 'loadlab-api',
      timestamp: new Date().toISOString(),
      uptime: 1,
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
    expect(
      await createApiClient({ baseUrl: 'https://api.example.test/', fetchImpl }).health(),
    ).toEqual(data);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.test/api/v1/health');
  });
  it('preserves HTTP status and request ID without displaying untrusted server text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_READY', message: 'secret' } }), {
        status: 503,
        headers: { 'X-Request-ID': 'request-123' },
      }),
    );
    await expect(createApiClient({ fetchImpl }).ready()).rejects.toMatchObject({
      status: 503,
      code: 'NOT_READY',
      requestId: 'request-123',
      message: 'Database unavailable or service shutting down.',
    });
  });
  it('reports network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createApiClient({ fetchImpl }).health()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
  it.each(['<html>Not JSON</html>', '{}'])('rejects an invalid API response', async (body) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body));
    await expect(createApiClient({ fetchImpl }).health()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('rejects invalid base URL before making a request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      createApiClient({ baseUrl: 'https://user:secret@example.test', fetchImpl }).health(),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('aborts slow requests with a useful timeout message', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const result = createApiClient({ fetchImpl, timeoutMs: 100 }).health();
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
  it('keeps caller cancellations distinct from network failures', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const result = createApiClient({ fetchImpl }).health({ signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
