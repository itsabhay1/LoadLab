import { Router } from 'express';
import { isDatabaseReady } from '../config/database.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'loadlab-api',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get('/ready', async (req, res) => {
  const available =
    !req.app.locals.shuttingDown && (await isDatabaseReady()) && !req.app.locals.shuttingDown;

  if (!available) {
    return res.status(503).json({
      error: {
        code: 'NOT_READY',
        message: 'Service is not ready. Database unavailable or shutdown in progress.',
        requestId: req.id,
      },
    });
  }

  return res.json({ status: 'ready', checks: { database: 'connected' } });
});

export default router;
