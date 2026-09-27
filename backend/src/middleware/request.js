import { randomUUID } from 'node:crypto';
import { logger } from '../config/logger.js';

export function requestLogger(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  const started = performance.now();
  res.once('finish', () => {
    logger.info({
      event: 'http_request',
      requestId: req.id,
      method: req.method,
      route: req.route?.path ?? 'unmatched',
      status: res.statusCode,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
  });
  next();
}
