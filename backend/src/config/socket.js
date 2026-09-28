import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { testRunEvents } from '../services/test-runner.js';
import { verifyAccessToken } from '../middleware/auth.js';
import { User } from '../models/user.js';
import { TestRun } from '../models/test-run.js';

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createSocketServer(httpServer, config) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.CLIENT_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest(request, callback) {
      const originAllowed = !request.headers.origin || request.headers.origin === config.CLIENT_URL;
      const addressAllowed =
        config.NODE_ENV === 'production' || LOCAL_ADDRESSES.has(request.socket.remoteAddress);
      callback(null, originAllowed && addressAllowed);
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      const error = new Error('Authentication is required.');
      error.data = { code: 'AUTH_REQUIRED' };
      return next(error);
    }
    let payload;
    try {
      payload = verifyAccessToken(token, config);
    } catch (verificationError) {
      const error = new Error('Authentication failed.');
      error.data = {
        code: verificationError.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      };
      return next(error);
    }
    try {
      if (!(await User.exists({ _id: payload.sub }))) {
        const error = new Error('Authenticated user is unavailable.');
        error.data = { code: 'USER_UNAVAILABLE' };
        return next(error);
      }
      socket.data.userId = payload.sub;
      socket.data.expiresAt = payload.exp * 1000;
      return next();
    } catch {
      const error = new Error('Authentication could not be completed.');
      error.data = { code: 'AUTH_UNAVAILABLE' };
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    const expirationTimer = setTimeout(
      () => {
        socket.emit('auth:error', { code: 'TOKEN_EXPIRED' });
        socket.disconnect(true);
      },
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    expirationTimer.unref?.();
    socket.once('disconnect', () => clearTimeout(expirationTimer));

    socket.on('run:subscribe', async (runId, acknowledge) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (typeof runId !== 'string' || !mongoose.isValidObjectId(runId)) {
        respond({ ok: false, code: 'INVALID_RUN_ID' });
        return;
      }
      if (socket.data.expiresAt <= Date.now()) {
        respond({ ok: false, code: 'TOKEN_EXPIRED' });
        socket.disconnect(true);
        return;
      }
      try {
        const owned = await TestRun.exists({ _id: runId, owner: socket.data.userId });
        if (!owned) {
          respond({ ok: false, code: 'RUN_NOT_FOUND' });
          return;
        }
        await socket.join(`run:${runId}`);
        respond({ ok: true });
      } catch {
        respond({ ok: false, code: 'SUBSCRIPTION_FAILED' });
      }
    });

    socket.on('run:unsubscribe', (runId) => {
      if (typeof runId === 'string' && mongoose.isValidObjectId(runId)) {
        socket.leave(`run:${runId}`);
      }
    });
  });

  const broadcast = (update) => io.to(`run:${update.runId}`).emit('run:update', update);
  testRunEvents.on('run:update', broadcast);

  return {
    io,
    close() {
      testRunEvents.off('run:update', broadcast);
      return new Promise((resolve) => io.close(resolve));
    },
  };
}
