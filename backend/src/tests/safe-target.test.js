import { describe, expect, it, vi } from 'vitest';
import {
  buildExternalTargetUrl,
  createPinnedLookup,
  isForbiddenAddress,
  normalizeExternalBaseUrl,
  resolveSafeTarget,
  TargetSafetyError,
  validateExternalRequest,
  verifyTargetOwnership,
} from '../services/safe-target.js';

describe('external target SSRF protection', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fec0::1',
    '::ffff:127.0.0.1',
  ])('blocks private, local, metadata or reserved address %s', (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each([
    'file:///tmp/data',
    'ftp://example.com',
    'data:text/plain,test',
    'gopher://example.com',
  ])('rejects unsafe protocol %s', (url) => {
    expect(() => normalizeExternalBaseUrl(url)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_PROTOCOL' }),
    );
  });

  it.each([
    'http://localhost',
    'http://service.localhost',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'https://[::1]',
  ])('rejects local or private literal target %s', (url) => {
    expect(() => normalizeExternalBaseUrl(url)).toThrowError(
      expect.objectContaining({ code: 'TARGET_FORBIDDEN' }),
    );
  });

  it('rejects custom ports, credentials and base URL paths', () => {
    for (const value of [
      'https://example.com:8443',
      'https://user:password@example.com',
      'https://example.com/api',
    ]) {
      expect(() => normalizeExternalBaseUrl(value)).toThrowError(
        expect.objectContaining({ code: 'INVALID_TARGET_URL' }),
      );
    }
  });

  it('rejects hostnames resolving to any private address to prevent rebinding', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolveSafeTarget('https://example.com/api', lookup)).rejects.toMatchObject({
      code: 'TARGET_PRIVATE_ADDRESS',
    });
  });

  it('pins subsequent connection lookups to the addresses already validated', async () => {
    const addresses = [{ address: '93.184.216.34', family: 4 }];
    const lookup = createPinnedLookup('example.com', addresses);
    await expect(
      new Promise((resolve, reject) =>
        lookup('example.com', {}, (error, address, family) =>
          error ? reject(error) : resolve({ address, family }),
        ),
      ),
    ).resolves.toEqual(addresses[0]);
    await expect(
      new Promise((resolve, reject) =>
        lookup('changed.example', {}, (error) => (error ? reject(error) : resolve())),
      ),
    ).rejects.toThrow('Pinned DNS hostname mismatch');
  });

  it('reports DNS lookup failures without exposing resolver details', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('resolver secret'));
    await expect(resolveSafeTarget('https://example.com', lookup)).rejects.toMatchObject({
      code: 'TARGET_DNS_FAILED',
      message: 'The target hostname could not be resolved.',
    });
  });
});

describe('target verification', () => {
  const token = 'a'.repeat(64);

  it('accepts only an exact token from the well-known endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: token });
    await expect(
      verifyTargetOwnership('https://api.example.com', token, { fetcher }),
    ).resolves.toBe(true);
    expect(fetcher.mock.calls[0][0].href).toBe(
      'https://api.example.com/.well-known/loadlab-verification.txt',
    );
  });

  it('rejects an incorrect token and a missing endpoint', async () => {
    await expect(
      verifyTargetOwnership('https://api.example.com', token, {
        fetcher: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: `${token}\n` }),
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_MISMATCH' });
    await expect(
      verifyTargetOwnership('https://api.example.com', token, {
        fetcher: vi.fn().mockResolvedValue({ statusCode: 404, headers: {}, body: '' }),
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
  });

  it('fails safely on timeout', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new TargetSafetyError('TARGET_TIMEOUT', 'The request timed out.'));
    await expect(
      verifyTargetOwnership('https://api.example.com', token, { fetcher }),
    ).rejects.toMatchObject({ code: 'TARGET_TIMEOUT' });
  });

  it('rejects redirects to private or different hosts', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      statusCode: 302,
      headers: { location: 'http://127.0.0.1/metadata' },
      body: '',
    });
    await expect(
      verifyTargetOwnership('https://api.example.com', token, { fetcher }),
    ).rejects.toMatchObject({ code: 'UNSAFE_REDIRECT' });
  });
});

describe('external request validation', () => {
  it('constructs paths without allowing a hostname override', () => {
    expect(buildExternalTargetUrl('https://api.example.com', '/api/products?q=1').href).toBe(
      'https://api.example.com/api/products?q=1',
    );
    for (const path of ['//evil.example/path', '/\\evil.example/path', 'https://evil.example']) {
      expect(() => buildExternalTargetUrl('https://api.example.com', path)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ENDPOINT_PATH' }),
      );
    }
  });

  it('allows supported methods and safe headers with a JSON body', () => {
    expect(
      validateExternalRequest('post', { Authorization: 'Bearer example' }, { query: 'test' }),
    ).toEqual({
      method: 'POST',
      headers: { authorization: 'Bearer example', 'content-type': 'application/json' },
      body: '{"query":"test"}',
    });
  });

  it.each(['Host', 'Connection', 'Transfer-Encoding', 'Content-Length', 'Proxy-Authorization'])(
    'rejects forbidden header %s',
    (header) => {
      expect(() => validateExternalRequest('GET', { [header]: 'unsafe' })).toThrowError(
        expect.objectContaining({ code: 'INVALID_HEADERS' }),
      );
    },
  );

  it('rejects unsupported methods', () => {
    expect(() => validateExternalRequest('TRACE')).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_METHOD' }),
    );
  });
});
