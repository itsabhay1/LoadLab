import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { io as createClient } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createSocketServer } from '../config/socket.js';
import { testRunEvents } from '../services/test-runner.js';

const clients = [];
const servers = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

async function setup() {
  const httpServer = createServer();
  const socketServer = createSocketServer(httpServer, { CLIENT_URL: 'http://localhost:5173' });
  servers.push(socketServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const client = createClient(`http://127.0.0.1:${port}`, {
    autoConnect: false,
    extraHeaders: { Origin: 'http://localhost:5173' },
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

function subscribe(client, runId) {
  return new Promise((resolve) => client.emit('run:subscribe', runId, resolve));
}

describe('live run socket', () => {
  it('broadcasts only subscribed aggregate run updates', async () => {
    const client = await setup();
    const runId = new mongoose.Types.ObjectId().toString();
    await connect(client);
    await expect(subscribe(client, runId)).resolves.toEqual({ ok: true });
    const updatePromise = new Promise((resolve) => client.once('run:update', resolve));
    testRunEvents.emit('run:update', {
      runId,
      status: 'RUNNING',
      capturedAt: new Date().toISOString(),
      metrics: { totalRequests: 10, rps: 5 },
    });
    await expect(updatePromise).resolves.toMatchObject({
      runId,
      status: 'RUNNING',
      metrics: { totalRequests: 10, rps: 5 },
    });
  });

  it('can resubscribe after a reconnect and rejects invalid run IDs', async () => {
    const client = await setup();
    const runId = new mongoose.Types.ObjectId().toString();
    await connect(client);
    await expect(subscribe(client, 'not-an-id')).resolves.toEqual({
      ok: false,
      code: 'INVALID_RUN_ID',
    });
    client.disconnect();
    await connect(client);
    await expect(subscribe(client, runId)).resolves.toEqual({ ok: true });
    const updatePromise = new Promise((resolve) => client.once('run:update', resolve));
    testRunEvents.emit('run:update', { runId, status: 'COMPLETED' });
    await expect(updatePromise).resolves.toMatchObject({ runId, status: 'COMPLETED' });
  });
});
