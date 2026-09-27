import process from 'node:process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'undici';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MOCK_PATHS = new Set(['/fast', '/slow', '/variable', '/flaky']);
const HISTOGRAM_RESOLUTION_MS = 0.1;

export const LOAD_LIMITS = Object.freeze({
  maxVirtualUsers: 1_000,
  maxDurationMs: 300_000,
  maxRampUpMs: 60_000,
  maxRequestTimeoutMs: 30_000,
  maxRequestsPerSecond: 5_000,
  maxConnections: 100,
  maxResponseBytes: 65_536,
});

export class LoadTestConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoadTestConfigError';
  }
}

function requireInteger(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new LoadTestConfigError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function parseLocalOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LoadTestConfigError('mockServerOrigin must be a valid URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.origin !== value ||
    url.username ||
    url.password
  ) {
    throw new LoadTestConfigError('mockServerOrigin must be an exact local HTTP origin.');
  }
  return url;
}

function validateConfig(input) {
  const mockServer = parseLocalOrigin(input.mockServerOrigin);
  let target;
  try {
    target = new URL(input.targetUrl);
  } catch {
    throw new LoadTestConfigError('targetUrl must be a valid URL.');
  }
  if (
    target.origin !== mockServer.origin ||
    !MOCK_PATHS.has(target.pathname) ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new LoadTestConfigError(
      'targetUrl must be an allowed endpoint on the configured local mock server.',
    );
  }

  const virtualUsers = requireInteger(
    'virtualUsers',
    input.virtualUsers,
    1,
    LOAD_LIMITS.maxVirtualUsers,
  );
  const durationMs = requireInteger('durationMs', input.durationMs, 50, LOAD_LIMITS.maxDurationMs);
  const rampUpMs = requireInteger(
    'rampUpMs',
    input.rampUpMs ?? 0,
    0,
    Math.min(durationMs - 1, LOAD_LIMITS.maxRampUpMs),
  );
  const requestTimeoutMs = requireInteger(
    'requestTimeoutMs',
    input.requestTimeoutMs ?? 5_000,
    10,
    LOAD_LIMITS.maxRequestTimeoutMs,
  );
  const requestsPerSecond = requireInteger(
    'requestsPerSecond',
    input.requestsPerSecond ?? 1_000,
    1,
    LOAD_LIMITS.maxRequestsPerSecond,
  );
  const maxConnections = requireInteger(
    'maxConnections',
    input.maxConnections ?? Math.min(virtualUsers, LOAD_LIMITS.maxConnections),
    1,
    Math.min(virtualUsers, LOAD_LIMITS.maxConnections),
  );

  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new LoadTestConfigError('signal must be an AbortSignal.');
  }

  return {
    target,
    virtualUsers,
    durationMs,
    rampUpMs,
    requestTimeoutMs,
    requestsPerSecond,
    maxConnections,
    signal: input.signal,
  };
}

function createMetrics(maxLatencyMs) {
  const histogram = new Uint32Array(Math.ceil(maxLatencyMs / HISTOGRAM_RESOLUTION_MS) + 2);
  let latencyTotal = 0;
  let latencyMinimum = Number.POSITIVE_INFINITY;
  let latencyMaximum = 0;
  let latencyCount = 0;

  return {
    totalRequests: 0,
    successes: 0,
    httpErrors: 0,
    networkErrors: 0,
    timedOutRequests: 0,
    activeVirtualUsers: 0,
    maxInFlightRequests: 0,
    recordLatency(value) {
      latencyTotal += value;
      latencyMinimum = Math.min(latencyMinimum, value);
      latencyMaximum = Math.max(latencyMaximum, value);
      latencyCount += 1;
      const bucket = Math.floor(value / HISTOGRAM_RESOLUTION_MS);
      histogram[Math.min(bucket, histogram.length - 1)] += 1;
    },
    summarize(elapsedMs, cancelled) {
      const percentile = (fraction) => {
        if (latencyCount === 0) return 0;
        const rank = Math.ceil(latencyCount * fraction);
        let seen = 0;
        for (let index = 0; index < histogram.length; index += 1) {
          seen += histogram[index];
          if (seen >= rank) return round(index * HISTOGRAM_RESOLUTION_MS);
        }
        return histogram.length - 1;
      };
      const round = (value) => Math.round(value * 100) / 100;

      return Object.freeze({
        totalRequests: this.totalRequests,
        successes: this.successes,
        httpErrors: this.httpErrors,
        networkErrors: this.networkErrors,
        timedOutRequests: this.timedOutRequests,
        rps: elapsedMs > 0 ? round(this.totalRequests / (elapsedMs / 1000)) : 0,
        averageLatencyMs: latencyCount > 0 ? round(latencyTotal / latencyCount) : 0,
        minLatencyMs: latencyCount > 0 ? round(latencyMinimum) : 0,
        maxLatencyMs: latencyCount > 0 ? round(latencyMaximum) : 0,
        p50LatencyMs: percentile(0.5),
        p95LatencyMs: percentile(0.95),
        activeVirtualUsers: this.activeVirtualUsers,
        maxInFlightRequests: this.maxInFlightRequests,
        elapsedMs: round(elapsedMs),
        cancelled,
      });
    },
  };
}

function createRateLimiter(requestsPerSecond, deadline) {
  const intervalMs = 1000 / requestsPerSecond;
  let nextStart = performance.now();

  return async (signal) => {
    const now = performance.now();
    const scheduled = Math.max(now, nextStart);
    nextStart = scheduled + intervalMs;
    if (scheduled >= deadline) return false;

    try {
      await delay(Math.max(0, scheduled - now), undefined, { signal });
      return !signal.aborted;
    } catch (error) {
      if (error.name === 'AbortError') return false;
      throw error;
    }
  };
}

function createRuntimeMonitor() {
  const cpuStartedAt = process.cpuUsage();
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  let peakRssBytes = 0;
  let peakHeapUsedBytes = 0;

  const sampleMemory = () => {
    const { rss, heapUsed } = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, heapUsed);
  };
  sampleMemory();
  eventLoopDelay.enable();
  const memorySampler = setInterval(sampleMemory, 100);
  memorySampler.unref();

  return {
    stop(elapsedMs) {
      clearInterval(memorySampler);
      sampleMemory();
      eventLoopDelay.disable();
      const cpu = process.cpuUsage(cpuStartedAt);
      const nanosecondsToMilliseconds = (value) => value / 1_000_000;
      const bytesToMegabytes = (value) => value / (1024 * 1024);
      const round = (value) => Math.round(value * 100) / 100;
      const cpuTotalMs = (cpu.user + cpu.system) / 1000;

      return Object.freeze({
        cpuUserMs: round(cpu.user / 1000),
        cpuSystemMs: round(cpu.system / 1000),
        cpuUtilizationPercent: elapsedMs > 0 ? round((cpuTotalMs / elapsedMs) * 100) : 0,
        peakRssMb: round(bytesToMegabytes(peakRssBytes)),
        peakHeapUsedMb: round(bytesToMegabytes(peakHeapUsedBytes)),
        eventLoopDelayMeanMs: round(nanosecondsToMilliseconds(eventLoopDelay.mean || 0)),
        eventLoopDelayP95Ms: round(nanosecondsToMilliseconds(eventLoopDelay.percentile(95))),
        eventLoopDelayMaxMs: round(nanosecondsToMilliseconds(eventLoopDelay.max)),
      });
    },
  };
}

export async function runLoadTest(input) {
  const config = validateConfig(input);
  const startedAt = performance.now();
  const deadline = startedAt + config.durationMs;
  const metrics = createMetrics(config.requestTimeoutMs);
  const runtimeMonitor = createRuntimeMonitor();
  const runController = new AbortController();
  let cancelled = config.signal?.aborted ?? false;
  let activeUsers = 0;
  let inFlightRequests = 0;

  const cancel = () => {
    cancelled = true;
    runController.abort();
  };
  config.signal?.addEventListener('abort', cancel, { once: true });
  if (cancelled) runController.abort();

  const durationTimer = setTimeout(() => runController.abort(), config.durationMs);
  const acquireRateSlot = createRateLimiter(config.requestsPerSecond, deadline);
  const pool = new Pool(config.target.origin, {
    connections: config.maxConnections,
    pipelining: 1,
    connectTimeout: config.requestTimeoutMs,
    headersTimeout: config.requestTimeoutMs,
    bodyTimeout: config.requestTimeoutMs,
    maxResponseSize: LOAD_LIMITS.maxResponseBytes,
  });

  async function makeRequest() {
    const requestStartedAt = performance.now();
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, config.requestTimeoutMs);
    const signal = AbortSignal.any([runController.signal, timeoutController.signal]);
    inFlightRequests += 1;
    metrics.maxInFlightRequests = Math.max(metrics.maxInFlightRequests, inFlightRequests);

    try {
      const { statusCode, body } = await pool.request({
        path: config.target.pathname,
        method: 'GET',
        signal,
      });
      await body.dump({ limit: LOAD_LIMITS.maxResponseBytes });
      const latency = performance.now() - requestStartedAt;
      metrics.totalRequests += 1;
      metrics.recordLatency(latency);
      if (statusCode >= 200 && statusCode < 400) metrics.successes += 1;
      else metrics.httpErrors += 1;
    } catch (error) {
      if (!runController.signal.aborted) {
        metrics.totalRequests += 1;
        metrics.networkErrors += 1;
        if (
          timedOut ||
          ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(
            error.code,
          )
        ) {
          metrics.timedOutRequests += 1;
        }
        metrics.recordLatency(performance.now() - requestStartedAt);
      }
    } finally {
      clearTimeout(timeout);
      inFlightRequests -= 1;
    }
  }

  async function runVirtualUser(index) {
    const startDelay =
      config.virtualUsers === 1 ? 0 : (index * config.rampUpMs) / (config.virtualUsers - 1);
    if (startDelay > 0) {
      try {
        await delay(startDelay, undefined, { signal: runController.signal });
      } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
      }
    }
    if (runController.signal.aborted) return;

    activeUsers += 1;
    metrics.activeVirtualUsers = Math.max(metrics.activeVirtualUsers, activeUsers);
    try {
      while (!runController.signal.aborted && performance.now() < deadline) {
        if (!(await acquireRateSlot(runController.signal))) break;
        await makeRequest();
      }
    } finally {
      activeUsers -= 1;
    }
  }

  let executionError;
  try {
    await Promise.all(
      Array.from({ length: config.virtualUsers }, (_value, index) => runVirtualUser(index)),
    );
  } catch (error) {
    executionError = error;
  } finally {
    clearTimeout(durationTimer);
    config.signal?.removeEventListener('abort', cancel);
    try {
      await pool.close();
    } catch (error) {
      executionError ??= error;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const result = Object.freeze({
    ...metrics.summarize(elapsedMs, cancelled),
    runtime: runtimeMonitor.stop(elapsedMs),
  });
  if (executionError) throw executionError;
  return result;
}
