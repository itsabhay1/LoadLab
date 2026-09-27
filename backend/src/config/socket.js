import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { testRunEvents } from '../services/test-runner.js';

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createSocketServer(httpServer, config) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.CLIENT_URL,
      methods: ['GET', 'POST'],
    },
    allowRequest(request, callback) {
      const originAllowed = !request.headers.origin || request.headers.origin === config.CLIENT_URL;
      const addressAllowed = LOCAL_ADDRESSES.has(request.socket.remoteAddress);
      callback(null, originAllowed && addressAllowed);
    },
  });

  io.on('connection', (socket) => {
    socket.on('run:subscribe', (runId, acknowledge = () => {}) => {
      if (typeof runId !== 'string' || !mongoose.isValidObjectId(runId)) {
        acknowledge({ ok: false, code: 'INVALID_RUN_ID' });
        return;
      }
      socket.join(`run:${runId}`);
      acknowledge({ ok: true });
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
