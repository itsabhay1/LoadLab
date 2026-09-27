import mongoose from 'mongoose';
import { logger, errorKind } from './logger.js';

mongoose.connection.on('connected', () => logger.info({ event: 'database_connected' }));
mongoose.connection.on('disconnected', () => logger.warn({ event: 'database_disconnected' }));
mongoose.connection.on('error', (error) => {
  logger.error({ event: 'database_error', kind: errorKind(error) });
});

export async function connectDatabase(uri) {
  mongoose.set('bufferCommands', false);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
    waitQueueTimeoutMS: 5000,
    heartbeatFrequencyMS: 2000,
    maxPoolSize: 10,
    minPoolSize: 0,
    autoIndex: false,
  });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export async function isDatabaseReady() {
  const connection = mongoose.connection;
  if (connection.readyState !== 1 || !connection.db) return false;

  try {
    await connection.db.admin().command({ ping: 1 }, { timeoutMS: 2000 });
    return connection.readyState === 1;
  } catch (error) {
    logger.warn({ event: 'database_ping_failed', kind: errorKind(error) });
    return false;
  }
}
