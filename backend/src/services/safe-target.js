import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Pool } from 'undici';

const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const VERIFICATION_PATH = '/.well-known/loadlab-verification.txt';
const VERIFICATION_TIMEOUT_MS = 5_000;
const VERIFICATION_MAX_BYTES = 1_024;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FORBIDDEN_HEADERS = new Set([
  'connection',
  'content-length',
  'forwarded',
  'host',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export class TargetSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetSafetyError';
    this.code = code;
  }
}

function unsafe(code = 'TARGET_FORBIDDEN') {
  throw new TargetSafetyError(code, 'The target destination is not allowed.');
}

function ipv4Parts(address) {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return undefined;
  }
  return parts;
}

function embeddedIpv4ToHex(value) {
  const parts = ipv4Parts(value);
  if (!parts) return undefined;
  return [
    `${((parts[0] << 8) | parts[1]).toString(16)}`,
    `${((parts[2] << 8) | parts[3]).toString(16)}`,
  ];
}

function ipv6Bytes(address) {
  let value = address.toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const lastSeparator = value.lastIndexOf(':');
    const embedded = embeddedIpv4ToHex(value.slice(lastSeparator + 1));
    if (!embedded) return undefined;
    value = `${value.slice(0, lastSeparator)}:${embedded.join(':')}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group)))
    return undefined;
  return groups.flatMap((group) => {
    const number = Number.parseInt(group, 16);
    return [number >> 8, number & 0xff];
  });
}

export function isForbiddenAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = ipv4Parts(address);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }
  if (family !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const allZero = bytes.every((value) => value === 0);
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const siteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
  const multicast = bytes[0] === 0xff;
  const mappedIpv4 =
    bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mappedIpv4) return isForbiddenAddress(bytes.slice(12).join('.'));
  return allZero || loopback || uniqueLocal || linkLocal || siteLocal || multicast;
}

function normalizedHostname(url) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

export function normalizeExternalBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TargetSafetyError('INVALID_TARGET_URL', 'Enter a valid HTTP or HTTPS target URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TargetSafetyError('UNSAFE_PROTOCOL', 'Only HTTP and HTTPS targets are supported.');
  }
  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (
    url.username ||
    url.password ||
    (url.port && url.port !== expectedPort) ||
    !['', '/'].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new TargetSafetyError(
      'INVALID_TARGET_URL',
      'Use an HTTP(S) origin without credentials, a path, query, fragment or custom port.',
    );
  }
  const hostname = normalizedHostname(url);
  if (!hostname || LOCAL_NAMES.has(hostname) || hostname.endsWith('.localhost')) unsafe();
  if (isIP(hostname) && isForbiddenAddress(hostname)) unsafe();
  return { baseUrl: url.origin, hostname };
}

export function buildExternalTargetUrl(baseUrl, endpointPath) {
  if (
    typeof endpointPath !== 'string' ||
    !endpointPath.startsWith('/') ||
    endpointPath.startsWith('//') ||
    endpointPath.includes('\\') ||
    endpointPath.includes('#')
  ) {
    throw new TargetSafetyError('INVALID_ENDPOINT_PATH', 'Enter a safe absolute endpoint path.');
  }
  const base = new URL(baseUrl);
  const target = new URL(endpointPath, base);
  if (target.origin !== base.origin || target.username || target.password || target.hash) {
    throw new TargetSafetyError('INVALID_ENDPOINT_PATH', 'The endpoint path cannot change hosts.');
  }
  return target;
}

export function validateExternalRequest(method, headers = {}, body) {
  const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : '';
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    throw new TargetSafetyError('UNSUPPORTED_METHOD', 'The HTTP method is not supported.');
  }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new TargetSafetyError('INVALID_HEADERS', 'Request headers must be an object.');
  }
  const entries = Object.entries(headers);
  if (entries.length > 20) {
    throw new TargetSafetyError('INVALID_HEADERS', 'At most 20 custom headers are allowed.');
  }
  const normalizedHeaders = {};
  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~\dA-Za-z-]{1,64}$/.test(name) ||
      FORBIDDEN_HEADERS.has(lowerName) ||
      lowerName.startsWith('proxy-') ||
      lowerName.startsWith('x-forwarded-') ||
      typeof value !== 'string' ||
      value.length > 1_000 ||
      /[\r\n]/.test(value)
    ) {
      throw new TargetSafetyError(
        'INVALID_HEADERS',
        'One or more request headers are not allowed.',
      );
    }
    normalizedHeaders[lowerName] = value;
  }
  let serializedBody;
  if (body !== undefined && body !== null) {
    try {
      serializedBody = JSON.stringify(body);
    } catch {
      throw new TargetSafetyError('INVALID_REQUEST_BODY', 'The request body must be valid JSON.');
    }
    if (serializedBody === undefined || Buffer.byteLength(serializedBody) > 32_768) {
      throw new TargetSafetyError(
        'INVALID_REQUEST_BODY',
        'The JSON request body must not exceed 32 KB.',
      );
    }
    normalizedHeaders['content-type'] ??= 'application/json';
  }
  return { method: normalizedMethod, headers: normalizedHeaders, body: serializedBody };
}

export function createPinnedLookup(hostname, addresses) {
  let nextAddress = 0;
  return (requestedHostname, options, callback) => {
    if (requestedHostname.toLowerCase() !== hostname.toLowerCase()) {
      callback(new Error('Pinned DNS hostname mismatch.'));
      return;
    }
    if (options?.all) {
      callback(
        null,
        addresses.map(({ address, family }) => ({ address, family })),
      );
      return;
    }
    const selected = addresses[nextAddress % addresses.length];
    nextAddress += 1;
    callback(null, selected.address, selected.family);
  };
}

export async function resolveSafeTarget(value, lookup = dnsLookup) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new TargetSafetyError('INVALID_TARGET_URL', 'Enter a valid HTTP or HTTPS target URL.');
  }
  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== expectedPort)
  ) {
    unsafe();
  }
  const hostname = normalizedHostname(url);
  if (LOCAL_NAMES.has(hostname) || hostname.endsWith('.localhost')) unsafe();
  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new TargetSafetyError('TARGET_DNS_FAILED', 'The target hostname could not be resolved.');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new TargetSafetyError('TARGET_DNS_FAILED', 'The target hostname could not be resolved.');
  }
  const normalized = addresses.map(({ address, family }) => ({ address, family: Number(family) }));
  if (
    normalized.some(
      ({ address, family }) => ![4, 6].includes(family) || isForbiddenAddress(address),
    )
  ) {
    unsafe('TARGET_PRIVATE_ADDRESS');
  }
  return { url, hostname, addresses: normalized };
}

async function fetchVerificationUrl(url, lookup) {
  const safe = await resolveSafeTarget(url, lookup);
  const pool = new Pool(safe.url.origin, {
    connections: 1,
    pipelining: 1,
    connectTimeout: VERIFICATION_TIMEOUT_MS,
    headersTimeout: VERIFICATION_TIMEOUT_MS,
    bodyTimeout: VERIFICATION_TIMEOUT_MS,
    maxResponseSize: VERIFICATION_MAX_BYTES,
    connect: { lookup: createPinnedLookup(safe.hostname, safe.addresses) },
  });
  try {
    const response = await pool.request({
      path: `${safe.url.pathname}${safe.url.search}`,
      method: 'GET',
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(VERIFICATION_TIMEOUT_MS),
    });
    const body = await response.body.text();
    return { statusCode: response.statusCode, headers: response.headers, body };
  } catch (error) {
    if (
      error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      /TIMEOUT/.test(error.code)
    ) {
      throw new TargetSafetyError('TARGET_TIMEOUT', 'The verification request timed out.');
    }
    if (error instanceof TargetSafetyError) throw error;
    throw new TargetSafetyError(
      'VERIFICATION_UNAVAILABLE',
      'The verification endpoint could not be reached.',
    );
  } finally {
    await pool.close().catch(() => pool.destroy());
  }
}

export async function verifyTargetOwnership(
  baseUrl,
  expectedToken,
  { lookup = dnsLookup, fetcher = fetchVerificationUrl } = {},
) {
  const base = new URL(baseUrl);
  let current = new URL(VERIFICATION_PATH, base);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetcher(current, lookup);
    if (REDIRECT_STATUSES.has(response.statusCode)) {
      const location = response.headers.location;
      if (!location || redirects === 3) {
        throw new TargetSafetyError('UNSAFE_REDIRECT', 'The verification redirect was rejected.');
      }
      const redirected = new URL(location, current);
      if (redirected.origin !== base.origin) {
        throw new TargetSafetyError('UNSAFE_REDIRECT', 'The verification redirect was rejected.');
      }
      await resolveSafeTarget(redirected, lookup);
      current = redirected;
      continue;
    }
    if (response.statusCode !== 200) {
      throw new TargetSafetyError(
        'VERIFICATION_UNAVAILABLE',
        'The verification endpoint did not return HTTP 200.',
      );
    }
    if (response.body !== expectedToken) {
      throw new TargetSafetyError('VERIFICATION_MISMATCH', 'The verification token did not match.');
    }
    return true;
  }
  return false;
}

export const VERIFICATION_ENDPOINT_PATH = VERIFICATION_PATH;
