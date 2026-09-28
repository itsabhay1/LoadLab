import { createServer } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { io as createClient } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userExists: vi.fn(), runExists: vi.fn() }));
vi.mock('../models/user.js', () => ({ User: { exists: mocks.userExists } }));
vi.mock('../models/test-run.js', () => ({ TestRun: { exists: mocks.runExists } }));

const { createSocketServer } = await import('../config/socket.js');
const { testRunEvents } = await import('../services/test-runner.js');
const clients = [];
const servers = [];
const ownerId = '507f1f77bcf86cd799439010';
const secret = 'test-secret-that-is-at-least-32-characters';
const config = {
  CLIENT_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: secret,
  JWT_ACCESS_EXPIRES_IN: '15m',
};

beforeEach(() => {
  mocks.userExists.mockResolvedValue(true);
  mocks.runExists.mockResolvedValue(true);
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

function token(options = { expiresIn: '1h' }) {
  return jwt.sign({ type: 'access' }, secret, { subject: ownerId, ...options });
}

async function setup(accessToken = token()) {
  const httpServer = createServer();
  const socketServer = createSocketServer(httpServer, config);
  servers.push(socketServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const client = createClient(`http://127.0.0.1:${port}`, {
    autoConnect: false,
    auth: accessToken ? { token: accessToken } : {},
    extraHeaders: { Origin: config.CLIENT_URL },
  });
  clients.push(client);
  return client;
}

function connect(client) {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
    client.connect();
  });
}

function connectError(client) {
  return new Promise((resolve) => {
    client.once('connect_error', resolve);
    client.connect();
  });
}

function subscribe(client, runId) {
  return new Promise((resolve) => client.emit('run:subscribe', runId, resolve));
}

describe('authenticated live run socket', () => {
  it('authenticates and broadcasts only to an authorized owner room', async () => {
    const client = await setup();
    const runId = new mongoose.Types.ObjectId().toString();
    await connect(client);
    await expect(subscribe(client, runId)).resolves.toEqual({ ok: true });
    expect(mocks.runExists).toHaveBeenCalledWith({ _id: runId, owner: ownerId });
    const updatePromise = new Promise((resolve) => client.once('run:update', resolve));
    testRunEvents.emit('run:update', {
      runId,
      status: 'RUNNING',
      metrics: { totalRequests: 10, rps: 5 },
    });
    await expect(updatePromise).resolves.toMatchObject({ runId, status: 'RUNNING' });
  });

  it('rejects missing and expired authentication', async () => {
    const missing = await setup(null);
    await expect(connectError(missing)).resolves.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    const expired = await setup(token({ expiresIn: -1 }));
    await expect(connectError(expired)).resolves.toMatchObject({ data: { code: 'TOKEN_EXPIRED' } });
  });

  it('rejects another user or unowned run subscription without joining the room', async () => {
    mocks.runExists.mockResolvedValue(false);
    const client = await setup();
    const runId = new mongoose.Types.ObjectId().toString();
    await connect(client);
    await expect(subscribe(client, runId)).resolves.toEqual({
      ok: false,
      code: 'RUN_NOT_FOUND',
    });
  });

  it('disconnects when the authenticated session expires', async () => {
    const client = await setup(token({ expiresIn: '1s' }));
    const authError = new Promise((resolve) => client.once('auth:error', resolve));
    const disconnected = new Promise((resolve) => client.once('disconnect', resolve));
    await connect(client);
    await expect(authError).resolves.toEqual({ code: 'TOKEN_EXPIRED' });
    await disconnected;
    expect(client.connected).toBe(false);
  });

  it('can authenticate again and resubscribe after reconnecting', async () => {
    const client = await setup();
    const runId = new mongoose.Types.ObjectId().toString();
    await connect(client);
    client.disconnect();
    client.auth = { token: token() };
    await connect(client);
    await expect(subscribe(client, runId)).resolves.toEqual({ ok: true });
    expect(mocks.userExists).toHaveBeenCalledTimes(2);
  });
});
