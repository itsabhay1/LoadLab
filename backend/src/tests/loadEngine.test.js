import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { LoadTestConfigError, runLoadTest } from '../services/loadEngine.js';

const servers = [];

async function startServer(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

function options(origin, overrides = {}) {
  return {
    mockServerOrigin: origin,
    targetUrl: `${origin}/fast`,
    virtualUsers: 4,
    durationMs: 150,
    rampUpMs: 0,
    requestTimeoutMs: 100,
    requestsPerSecond: 200,
    maxConnections: 4,
    ...overrides,
  };
}

describe('load engine', () => {
  it('enforces the connection limit while keeping each user sequential', async () => {
    let active = 0;
    let maximum = 0;
    const origin = await startServer((_request, response) => {
      active += 1;
      maximum = Math.max(maximum, active);
      setTimeout(() => {
        active -= 1;
        response.end('ok');
      }, 40);
    });

    const result = await runLoadTest(
      options(origin, {
        virtualUsers: 8,
        durationMs: 220,
        requestTimeoutMs: 1000,
        maxConnections: 2,
        requestsPerSecond: 1000,
      }),
    );

    expect(maximum).toBeLessThanOrEqual(2);
    expect(result.maxInFlightRequests).toBeLessThanOrEqual(8);
    expect(result.successes).toBeGreaterThan(0);
  });

  it('stops near the configured duration', async () => {
    const origin = await startServer((_request, response) => response.end('ok'));
    const result = await runLoadTest(options(origin, { durationMs: 140 }));

    expect(result.elapsedMs).toBeGreaterThanOrEqual(120);
    expect(result.elapsedMs).toBeLessThan(350);
  });

  it('starts virtual users gradually during ramp-up', async () => {
    const arrivals = [];
    const origin = await startServer((_request, response) => {
      arrivals.push(performance.now());
      setTimeout(() => response.end('ok'), 220);
    });
    const startedAt = performance.now();

    const result = await runLoadTest(
      options(origin, {
        virtualUsers: 4,
        durationMs: 320,
        rampUpMs: 150,
        requestTimeoutMs: 280,
        maxConnections: 4,
        requestsPerSecond: 1000,
      }),
    );

    const offsets = arrivals.slice(0, 4).map((time) => time - startedAt);
    expect(offsets).toHaveLength(4);
    expect(offsets[1]).toBeGreaterThanOrEqual(25);
    expect(offsets[3]).toBeGreaterThanOrEqual(110);
    expect(result.activeVirtualUsers).toBe(4);
  });

  it('records request timeouts without stopping other users', async () => {
    const origin = await startServer((_request, response) => {
      setTimeout(() => response.end('late'), 150);
    });
    const result = await runLoadTest(
      options(origin, { durationMs: 170, requestTimeoutMs: 25, requestsPerSecond: 100 }),
    );

    expect(result.timedOutRequests).toBeGreaterThan(0);
    expect(result.networkErrors).toBe(result.timedOutRequests);
    expect(result.totalRequests).toBe(result.networkErrors);
  });

  it('cancels in-flight work gracefully', async () => {
    const origin = await startServer((_request, response) => {
      setTimeout(() => response.end('ok'), 200);
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);

    const result = await runLoadTest(
      options(origin, { durationMs: 1000, requestTimeoutMs: 500, signal: controller.signal }),
    );

    expect(result.cancelled).toBe(true);
    expect(result.elapsedMs).toBeLessThan(350);
  });

  it('calculates success, HTTP error, throughput and latency metrics', async () => {
    let count = 0;
    const origin = await startServer((_request, response) => {
      count += 1;
      response.statusCode = count % 2 === 0 ? 500 : 200;
      response.end('result');
    });
    const result = await runLoadTest(options(origin, { requestsPerSecond: 50 }));

    expect(result.totalRequests).toBe(result.successes + result.httpErrors + result.networkErrors);
    expect(result.successes).toBeGreaterThan(0);
    expect(result.httpErrors).toBeGreaterThan(0);
    expect(result.rps).toBeGreaterThan(0);
    expect(result.minLatencyMs).toBeLessThanOrEqual(result.averageLatencyMs);
    expect(result.averageLatencyMs).toBeLessThanOrEqual(result.maxLatencyMs);
    expect(result.p50LatencyMs).toBeLessThanOrEqual(result.p95LatencyMs);
    expect(result.runtime).toEqual(
      expect.objectContaining({
        cpuUtilizationPercent: expect.any(Number),
        peakRssMb: expect.any(Number),
        peakHeapUsedMb: expect.any(Number),
        eventLoopDelayP95Ms: expect.any(Number),
      }),
    );
  });

  it('emits bounded aggregate snapshots without request-level data', async () => {
    const origin = await startServer((_request, response) => response.end('ok'));
    const snapshots = [];
    await runLoadTest(
      options(origin, {
        durationMs: 1100,
        snapshotIntervalMs: 1000,
        onSnapshot: (snapshot) => snapshots.push(snapshot),
      }),
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        totalRequests: expect.any(Number),
        p95LatencyMs: expect.any(Number),
        runtime: expect.objectContaining({ peakRssMb: expect.any(Number) }),
      }),
    );
    expect(snapshots[0]).not.toHaveProperty('requests');
  });

  it('enforces the global request start-rate limit', async () => {
    const origin = await startServer((_request, response) => response.end('ok'));
    const result = await runLoadTest(
      options(origin, {
        virtualUsers: 10,
        durationMs: 260,
        requestsPerSecond: 10,
        maxConnections: 10,
      }),
    );

    expect(result.totalRequests).toBeGreaterThanOrEqual(2);
    expect(result.totalRequests).toBeLessThanOrEqual(3);
  });

  it('keeps running when the configured local target is unavailable', async () => {
    const origin = await startServer((_request, response) => response.end('ok'));
    const port = new URL(origin).port;
    const server = servers.pop();
    await new Promise((resolve) => server.close(resolve));

    const result = await runLoadTest(
      options(`http://127.0.0.1:${port}`, {
        durationMs: 100,
        requestTimeoutMs: 25,
        requestsPerSecond: 20,
      }),
    );

    expect(result.totalRequests).toBeGreaterThan(0);
    expect(result.networkErrors).toBe(result.totalRequests);
    expect(result.successes).toBe(0);
  });

  it.each([
    {
      mockServerOrigin: 'https://example.com',
      targetUrl: 'https://example.com/fast',
    },
    {
      mockServerOrigin: 'http://127.0.0.1:5050',
      targetUrl: 'http://127.0.0.1:5050/private',
    },
    {
      mockServerOrigin: 'http://127.0.0.1:5050',
      targetUrl: 'http://127.0.0.1:5050/fast',
      virtualUsers: 1001,
    },
  ])('rejects unsafe or excessive configuration', async (override) => {
    await expect(
      runLoadTest({
        ...options('http://127.0.0.1:5050'),
        ...override,
      }),
    ).rejects.toBeInstanceOf(LoadTestConfigError);
  });

  it('bounds connections and promises with 1000 virtual users', async () => {
    let activeConnections = 0;
    let maximumConnections = 0;
    const origin = await startServer((_request, response) => {
      activeConnections += 1;
      maximumConnections = Math.max(maximumConnections, activeConnections);
      setTimeout(() => {
        activeConnections -= 1;
        response.end('ok');
      }, 30);
    });

    const result = await runLoadTest(
      options(origin, {
        virtualUsers: 1000,
        durationMs: 180,
        requestTimeoutMs: 1000,
        requestsPerSecond: 5000,
        maxConnections: 25,
      }),
    );

    expect(result.activeVirtualUsers).toBe(1000);
    expect(result.maxInFlightRequests).toBeLessThanOrEqual(1000);
    expect(maximumConnections).toBeLessThanOrEqual(25);
    expect(result.totalRequests).toBe(result.successes + result.httpErrors + result.networkErrors);
    expect(result.elapsedMs).toBeLessThan(1200);
  });

  it('cancels 1000 virtual users without leaving the run active', async () => {
    const origin = await startServer((_request, response) => {
      setTimeout(() => response.end('ok'), 200);
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 75);

    const result = await runLoadTest(
      options(origin, {
        virtualUsers: 1000,
        durationMs: 1000,
        requestTimeoutMs: 500,
        requestsPerSecond: 5000,
        maxConnections: 25,
        signal: controller.signal,
      }),
    );

    expect(result.cancelled).toBe(true);
    expect(result.maxInFlightRequests).toBeLessThanOrEqual(1000);
    expect(result.elapsedMs).toBeLessThan(500);
  });
});
