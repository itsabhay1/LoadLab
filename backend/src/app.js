import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import healthRoutes from './routes/health-routes.js';
import testRoutes from './routes/test-routes.js';
import authRoutes from './routes/auth-routes.js';
import targetRoutes from './routes/target-routes.js';
import { requestLogger } from './middleware/request.js';
import { createHttpError, errorHandler } from './middleware/error.js';

const DEFAULT_FRONTEND_DIST = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
const SPA_ROUTE = /^\/(?!api(?:\/|$)|socket\.io(?:\/|$)).*/;

export function createApp(config, { frontendDistPath = DEFAULT_FRONTEND_DIST } = {}) {
  const app = express();
  app.set('env', config.NODE_ENV);
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.locals.config = config;
  app.locals.shuttingDown = false;
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
          'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
          'frame-src': ["'self'", 'https://accounts.google.com/gsi/'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === config.CLIENT_URL) return callback(null, true);
        return callback(
          createHttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'),
        );
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      credentials: true,
      exposedHeaders: ['X-Request-ID'],
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/v1', healthRoutes);
  app.use('/api/v1', authRoutes);
  app.use('/api/v1', targetRoutes);
  app.use('/api/v1', testRoutes);
  if (config.NODE_ENV === 'production') {
    app.use(express.static(frontendDistPath, { index: false, fallthrough: true }));
    app.get(SPA_ROUTE, (_req, res, next) => {
      res.sendFile(path.join(frontendDistPath, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }
  app.use((_req, _res, next) => {
    next(createHttpError(404, 'NOT_FOUND', 'The requested resource was not found.'));
  });
  app.use(errorHandler);
  return app;
}
