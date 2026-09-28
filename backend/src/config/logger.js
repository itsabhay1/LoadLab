import pino from 'pino';

export const logger = pino(
  {
    level: 'info',
    base: { service: 'loadlab-api' },
    redact: [
      'password',
      'token',
      'authorization',
      'cookie',
      'credential',
      'verificationToken',
      'MONGODB_URI',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'req.headers',
    ],
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
