import pino from 'pino';

export const logger = pino(
  {
    level: 'info',
    base: { service: 'loadlab-api' },
    redact: ['password', 'token', 'authorization', 'MONGODB_URI', 'req.headers'],
  },
  pino.destination({ sync: true }),
);

export function errorKind(error) {
  const allowed = new Set([
    'Error',
    'TypeError',
    'SyntaxError',
    'RangeError',
    'MongooseServerSelectionError',
    'MongoServerSelectionError',
    'MongoNetworkError',
    'MongoServerError',
  ]);
  return allowed.has(error?.name) ? error.name : 'Error';
}
