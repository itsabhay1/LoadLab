import { createHttpError } from './error.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_KEYS = 10_000;
const attempts = new Map();

export function authRateLimit(req, _res, next) {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    if (attempts.size >= MAX_KEYS) {
      for (const [storedKey, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(storedKey);
      }
      if (attempts.size >= MAX_KEYS) attempts.delete(attempts.keys().next().value);
    }
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    return next(
      createHttpError(
        429,
        'AUTH_RATE_LIMITED',
        'Too many authentication attempts. Try again later.',
      ),
    );
  }
  return next();
}
