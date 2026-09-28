import process from 'node:process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { parseEnv } from './config/env.js';
import { errorKind, logger } from './config/logger.js';
import { createSocketServer } from './config/socket.js';
import { recoverInterruptedRuns } from './services/test-runner.js';

let app;
let server;
let socketServer;
let stopping = false;
let exitCode = 0;

export async function shutdown(reason, code = 0) {
  exitCode = Math.max(exitCode, code);
  if (stopping) return;
  stopping = true;
  if (app) app.locals.shuttingDown = true;
  logger.info({ event: 'shutdown_started', reason });

  const deadline = setTimeout(() => {
    logger.fatal({ event: 'shutdown_timeout' });
    server?.closeAllConnections();
    process.exit(1);
  }, 10000);

  try {
    if (socketServer) await socketServer.close();
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    }
  } catch (error) {
    exitCode = 1;
    logger.error({ event: 'shutdown_failed', kind: errorKind(error) });
  }

  try {
    await disconnectDatabase();
  } catch (error) {
    exitCode = 1;
    logger.error({ event: 'shutdown_failed', kind: errorKind(error) });
  }

  clearTimeout(deadline);

  logger.info({ event: 'shutdown_complete', exitCode });
  process.exit(exitCode);
}

function registerProcessHandlers() {
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('uncaughtException', (error) => {
    logger.fatal({ event: 'uncaught_exception', kind: errorKind(error) });
    void shutdown('uncaught_exception', 1);
  });
  process.once('unhandledRejection', (error) => {
    logger.fatal({ event: 'unhandled_rejection', kind: errorKind(error) });
    void shutdown('unhandled_rejection', 1);
  });
}

export async function startServer() {
  registerProcessHandlers();
  let stage = 'configuration';

  try {
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
    const config = parseEnv(process.env);
    app = createApp(config);

    stage = 'database';
    await connectDatabase(config.MONGODB_URI);
    if (stopping) return;

    stage = 'recovery';
    const interruptedRuns = await recoverInterruptedRuns();
    if (interruptedRuns > 0) {
      logger.warn({ event: 'test_runs_interrupted', count: interruptedRuns });
    }

    stage = 'listen';
    server = createServer(app);
    socketServer = createSocketServer(server, config);
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    const host = config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.PORT, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => {
      logger.fatal({ event: 'server_error', kind: errorKind(error) });
      void shutdown('server_error', 1);
    });
    logger.info({
      event: 'server_started',
      host,
      port: config.PORT,
      environment: config.NODE_ENV,
    });
  } catch (error) {
    logger.fatal({
      event: 'startup_failed',
      stage,
      kind: errorKind(error),
      ...(stage === 'configuration'
        ? { message: 'Check the required environment variables.' }
        : {}),
    });
    await shutdown('startup_failed', 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startServer();
}
