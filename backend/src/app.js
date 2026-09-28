import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRoutes from './routes/health-routes.js';
import testRoutes from './routes/test-routes.js';
import authRoutes from './routes/auth-routes.js';
import { requestLogger } from './middleware/request.js';
import { createHttpError, errorHandler } from './middleware/error.js';

export function createApp(config) {
  const app = express();
  app.set('env', config.NODE_ENV);
  app.locals.config = config;
  app.locals.shuttingDown = false;
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(helmet());
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
  app.use('/api/v1', testRoutes);
  app.use((_req, _res, next) => {
    next(createHttpError(404, 'NOT_FOUND', 'The requested resource was not found.'));
  });
  app.use(errorHandler);
  return app;
}
