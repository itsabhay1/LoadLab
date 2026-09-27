import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase, isDatabaseReady } from '../config/database.js';
import { logger } from '../config/logger.js';

vi.mock('mongoose', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: {
      connection: new EventEmitter(),
      set: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock('../config/logger.js', async (importOriginal) => ({
  ...(await importOriginal()),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const connection = mongoose.connection;
const command = vi.fn();
beforeEach(() => {
  connection.readyState = 1;
  connection.db = { admin: () => ({ command }) };
  command.mockReset().mockResolvedValue({ ok: 1 });
  mongoose.connect.mockReset().mockResolvedValue();
  mongoose.disconnect.mockReset().mockResolvedValue();
});

describe('MongoDB connection and readiness', () => {
  it('uses bounded connection options and disables query buffering', async () => {
    await connectDatabase('mongodb://localhost/test');
    expect(mongoose.set).toHaveBeenCalledWith('bufferCommands', false);
    expect(mongoose.connect).toHaveBeenCalledWith(
      'mongodb://localhost/test',
      expect.objectContaining({
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        maxPoolSize: 10,
      }),
    );
  });
  it('propagates initial connection rejection for startup to handle', async () => {
    mongoose.connect.mockRejectedValue(new Error('connection refused'));
    await expect(connectDatabase('mongodb://localhost/test')).rejects.toThrow('connection refused');
  });
  it('pings the driver connection with a timeout', async () => {
    expect(await isDatabaseReady()).toBe(true);
    expect(command).toHaveBeenCalledWith({ ping: 1 }, { timeoutMS: 2000 });
  });
  it('disconnection fails readiness and a recovered connection succeeds', async () => {
    connection.readyState = 0;
    connection.emit('disconnected');
    expect(await isDatabaseReady()).toBe(false);
    expect(command).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ event: 'database_disconnected' });
    connection.readyState = 1;
    connection.emit('connected');
    expect(await isDatabaseReady()).toBe(true);
    expect(logger.info).toHaveBeenCalledWith({ event: 'database_connected' });
  });
  it('fails readiness if the driver loses its connection during a ping', async () => {
    command.mockImplementation(async () => {
      connection.readyState = 0;
    });
    expect(await isDatabaseReady()).toBe(false);
  });
  it('fails readiness when no database handle is available', async () => {
    connection.db = undefined;
    expect(await isDatabaseReady()).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
  it('ping and driver errors are logged without credentials', async () => {
    const error = new Error('mongodb://user:secret@host/db');
    command.mockRejectedValue(error);
    connection.emit('error', error);
    expect(await isDatabaseReady()).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls])).not.toContain(
      'secret',
    );
  });
  it('disconnects the driver', async () => {
    await disconnectDatabase();
    expect(mongoose.disconnect).toHaveBeenCalledOnce();
  });
  it('propagates disconnect failures for shutdown to handle', async () => {
    mongoose.disconnect.mockRejectedValue(new Error('close failed'));
    await expect(disconnectDatabase()).rejects.toThrow('close failed');
    expect(mongoose.disconnect).toHaveBeenCalledOnce();
  });
});
