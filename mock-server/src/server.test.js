import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer } from './server.js';

let server;
let origin;

beforeEach(async () => {
  server = createMockServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(
  () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
);

describe('mock server', () => {
  it('provides fast, slow and variable successful endpoints', async () => {
    for (const path of ['/fast', '/slow', '/variable']) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect((await response.json()).endpoint).toBe(path.slice(1));
    }
  });

  it('fails every third flaky request predictably', async () => {
    const statuses = [];
    for (let count = 0; count < 3; count += 1) {
      statuses.push((await fetch(`${origin}/flaky`)).status);
    }
    expect(statuses).toEqual([200, 200, 503]);
  });
});
