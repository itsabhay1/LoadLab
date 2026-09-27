import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock module boundaries, rather than adding test-only dependencies to application code.
const mocks = vi.hoisted(() => ({
  process: { env: {}, argv: [], once: vi.fn(), exit: vi.fn() },
  config: {
    PORT: 5000,
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost/test',
    CLIENT_URL: 'http://localhost:5173',
  },
  parseEnv: vi.fn(),
  connectDatabase: vi.fn(),
  disconnectDatabase: vi.fn(),
  recoverInterruptedRuns: vi.fn(),
  createServer: vi.fn(),
  createSocketServer: vi.fn(),
  closeSocketServer: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));
vi.mock('node:process', () => ({ default: mocks.process }));
vi.mock('node:http', () => ({ createServer: mocks.createServer }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../config/env.js', () => ({ parseEnv: mocks.parseEnv }));
vi.mock('../config/database.js', () => ({
  connectDatabase: mocks.connectDatabase,
  disconnectDatabase: mocks.disconnectDatabase,
}));
vi.mock('../config/logger.js', async (importOriginal) => ({
  ...(await importOriginal()),
  logger: mocks.logger,
}));
vi.mock('../services/test-runner.js', () => ({
  recoverInterruptedRuns: mocks.recoverInterruptedRuns,
}));
vi.mock('../config/socket.js', () => ({ createSocketServer: mocks.createSocketServer }));

let signals;
let server;
beforeEach(() => {
  vi.resetModules();
  signals = new EventEmitter();
  mocks.process.once.mockImplementation((event, handler) => signals.once(event, handler));
  mocks.parseEnv.mockReturnValue(mocks.config);
  mocks.connectDatabase.mockReset().mockResolvedValue();
  mocks.disconnectDatabase.mockReset().mockResolvedValue();
  mocks.recoverInterruptedRuns.mockReset().mockResolvedValue(0);
  mocks.closeSocketServer.mockReset().mockResolvedValue();
  mocks.createSocketServer.mockReset().mockReturnValue({ close: mocks.closeSocketServer });
  server = new EventEmitter();
  server.listening = false;
  server.listen = vi.fn((_port, _host, done) => {
    server.listening = true;
    done();
  });
  server.close = vi.fn((done) => {
    server.listening = false;
    done();
  });
  server.closeIdleConnections = vi.fn();
  server.closeAllConnections = vi.fn();
  mocks.createServer.mockReturnValue(server);
});
afterEach(() => vi.useRealTimers());

async function boot() {
  const { startServer } = await import('../server.js');
  await startServer();
  return mocks.createServer.mock.calls[0]?.[0];
}

describe('server startup and shutdown', () => {
  it('connects before listening and configures HTTP timeouts', async () => {
    await boot();
    expect(mocks.connectDatabase).toHaveBeenCalledWith(mocks.config.MONGODB_URI);
    expect(mocks.connectDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recoverInterruptedRuns.mock.invocationCallOrder[0],
    );
    expect(mocks.recoverInterruptedRuns.mock.invocationCallOrder[0]).toBeLessThan(
      server.listen.mock.invocationCallOrder[0],
    );
    expect(server.listen).toHaveBeenCalledWith(5000, '127.0.0.1', expect.any(Function));
    expect(mocks.createSocketServer).toHaveBeenCalledWith(server, mocks.config);
    expect(server).toMatchObject({
      requestTimeout: 15000,
      headersTimeout: 10000,
      keepAliveTimeout: 5000,
    });
    signals.emit('SIGTERM');
    await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(0));
  });

  it.each(['SIGINT', 'SIGTERM'])(
    'handles %s, drains HTTP, then closes MongoDB once',
    async (signal) => {
      const app = await boot();
      signals.emit(signal);
      signals.emit(signal);
      expect(app.locals.shuttingDown).toBe(true);
      await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(0));
      expect(server.close).toHaveBeenCalledOnce();
      expect(mocks.closeSocketServer).toHaveBeenCalledOnce();
      expect(server.closeIdleConnections).toHaveBeenCalledOnce();
      expect(mocks.disconnectDatabase).toHaveBeenCalledOnce();
      expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.disconnectDatabase.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([
    ['uncaughtException', 'uncaught_exception'],
    ['unhandledRejection', 'unhandled_rejection'],
  ])('handles %s without logging secrets', async (event, logEvent) => {
    await boot();
    signals.emit(event, new Error('mongodb://user:secret@host/db'));
    await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(1));
    expect(mocks.logger.fatal).toHaveBeenCalledWith({ event: logEvent, kind: 'Error' });
    expect(JSON.stringify(mocks.logger.fatal.mock.calls)).not.toContain('secret');
  });

  it('closes MongoDB and exits nonzero when the initial connection fails', async () => {
    mocks.connectDatabase.mockRejectedValue(new Error('mongodb://user:secret@host/db'));
    await boot();
    expect(server.listen).not.toHaveBeenCalled();
    expect(mocks.disconnectDatabase).toHaveBeenCalledOnce();
    expect(mocks.process.exit).toHaveBeenCalledWith(1);
    expect(mocks.logger.fatal).toHaveBeenCalledWith({
      event: 'startup_failed',
      stage: 'database',
      kind: 'Error',
    });
    expect(JSON.stringify(mocks.logger.fatal.mock.calls)).not.toContain('secret');
  });

  it('cleans up when the listening port is unavailable', async () => {
    server.listen.mockImplementation(() => {
      server.emit('error', new Error('EADDRINUSE'));
    });
    await boot();
    expect(mocks.process.exit).toHaveBeenCalledWith(1);
    expect(mocks.disconnectDatabase).toHaveBeenCalledOnce();
    expect(mocks.logger.fatal).toHaveBeenCalledWith({
      event: 'startup_failed',
      stage: 'listen',
      kind: 'Error',
    });
  });

  it('shuts down after an HTTP server error', async () => {
    await boot();
    server.emit('error', new Error('server failed'));
    await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(1));
    expect(mocks.disconnectDatabase).toHaveBeenCalledOnce();
  });

  it('logs database cleanup failures and exits nonzero', async () => {
    await boot();
    mocks.disconnectDatabase.mockRejectedValue(new Error('secret'));
    signals.emit('SIGTERM');
    await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(1));
    expect(mocks.logger.error).toHaveBeenCalledWith({ event: 'shutdown_failed', kind: 'Error' });
  });

  it('still closes MongoDB if HTTP draining fails', async () => {
    await boot();
    server.close.mockImplementation((done) => done(new Error('close failed')));
    signals.emit('SIGTERM');
    await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(1));
    expect(mocks.disconnectDatabase).toHaveBeenCalledOnce();
  });

  it('retains a fatal exit code when a second failure arrives during shutdown', async () => {
    await boot();
    let finish;
    server.close.mockImplementation((done) => {
      finish = done;
    });
    signals.emit('SIGTERM');
    signals.emit('unhandledRejection', new Error('fatal'));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish();
    await vi.waitFor(() => expect(mocks.process.exit).toHaveBeenCalledWith(1));
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('does not start listening when shutdown begins during the initial connection', async () => {
    mocks.connectDatabase.mockImplementation(async () => {
      signals.emit('SIGTERM');
    });
    await boot();
    expect(server.listen).not.toHaveBeenCalled();
    expect(mocks.disconnectDatabase).toHaveBeenCalledOnce();
    expect(mocks.process.exit).toHaveBeenCalledWith(0);
  });

  it('forces exit after ten seconds if HTTP draining hangs', async () => {
    vi.useFakeTimers();
    await boot();
    server.close.mockImplementation(() => {});
    signals.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(10000);
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(mocks.process.exit).toHaveBeenCalledWith(1);
  });
});
