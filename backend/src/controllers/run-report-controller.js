import mongoose from 'mongoose';
import { createHttpError } from '../middleware/error.js';
import { RUN_STATUS, TestRun } from '../models/test-run.js';
import { Target, TARGET_STATUS } from '../models/target.js';

const SENSITIVE_KEY = /password|passphrase|secret|token|authorization|cookie|api[-_]?key/i;

function requireRunId(value) {
  if (!mongoose.isValidObjectId(value)) {
    throw createHttpError(400, 'INVALID_ID', 'Run ID is invalid.');
  }
}

function number(value) {
  return Number.isFinite(value) ? value : 0;
}

function errorRate(metrics) {
  const total = number(metrics?.totalRequests);
  if (total === 0) return 0;
  return ((number(metrics?.httpErrors) + number(metrics?.networkErrors)) / total) * 100;
}

function percentageChange(before, after) {
  if (before === 0) return after === 0 ? 0 : null;
  return ((after - before) / Math.abs(before)) * 100;
}

function runConfiguration(run) {
  const configuration = run.configurationSnapshot ?? {};
  let endpoint = configuration.targetUrl;
  let target = configuration.targetUrl;
  try {
    const url = new URL(configuration.targetUrl);
    target = url.origin;
    endpoint = `${url.pathname}${url.search}`;
  } catch {
    // Preserve the immutable snapshot value if an old run contains a non-URL target.
  }
  return {
    target,
    targetMode: configuration.targetMode ?? 'LOCAL',
    method: configuration.method ?? 'GET',
    endpoint,
    virtualUsers: configuration.virtualUsers,
    durationMs: configuration.durationMs,
    rampUpMs: configuration.rampUpMs,
    maxConnections: configuration.maxConnections,
    requestsPerSecond: configuration.requestsPerSecond,
    requestTimeoutMs: configuration.requestTimeoutMs,
  };
}

function runMetrics(metrics) {
  const runtime = metrics?.runtime ?? {};
  return {
    completedRequests: number(metrics?.totalRequests),
    successfulRequests: number(metrics?.successes),
    httpErrors: number(metrics?.httpErrors),
    networkErrors: number(metrics?.networkErrors),
    timeouts: number(metrics?.timedOutRequests),
    rps: number(metrics?.rps),
    averageLatencyMs: number(metrics?.averageLatencyMs),
    minLatencyMs: number(metrics?.minLatencyMs),
    maxLatencyMs: number(metrics?.maxLatencyMs),
    p50LatencyMs: number(metrics?.p50LatencyMs),
    p95LatencyMs: number(metrics?.p95LatencyMs),
    peakVirtualUsers: number(metrics?.activeVirtualUsers),
    errorRatePercent: errorRate(metrics),
    cpuUtilizationPercent: number(runtime.cpuUtilizationPercent),
    cpuUserMs: number(runtime.cpuUserMs),
    cpuSystemMs: number(runtime.cpuSystemMs),
    peakRssMb: number(runtime.peakRssMb),
    peakHeapUsedMb: number(runtime.peakHeapUsedMb),
    eventLoopDelayMeanMs: number(runtime.eventLoopDelayMeanMs),
    eventLoopDelayP95Ms: number(runtime.eventLoopDelayP95Ms),
    eventLoopDelayMaxMs: number(runtime.eventLoopDelayMaxMs),
  };
}

function comparisonRun(run) {
  return {
    id: String(run._id),
    planId: String(run.plan?._id ?? run.plan),
    name: run.configurationSnapshot?.name ?? 'Deleted plan',
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    configuration: runConfiguration(run),
    metrics: runMetrics(run.finalMetrics),
    finalMetrics: run.finalMetrics,
    snapshots: (run.snapshots ?? []).map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      metrics: snapshot.metrics,
    })),
  };
}

export function calculateRunDeltas(runA, runB) {
  const a = runMetrics(runA.finalMetrics);
  const b = runMetrics(runB.finalMetrics);
  return {
    rpsDifference: b.rps - a.rps,
    rpsPercentageChange: percentageChange(a.rps, b.rps),
    p50DifferenceMs: b.p50LatencyMs - a.p50LatencyMs,
    p95DifferenceMs: b.p95LatencyMs - a.p95LatencyMs,
    errorRateDifferencePoints: b.errorRatePercent - a.errorRatePercent,
  };
}

function sanitize(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (value instanceof Date) return value;
  if (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(value)
  ) {
    return undefined;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)])
        .filter(([, childValue]) => childValue !== undefined),
    );
  }
  return value;
}

export function createRunExport(run) {
  return {
    metadata: {
      id: String(run._id),
      planId: String(run.plan?._id ?? run.plan),
      status: run.status,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      reason: run.reason,
    },
    configuration: sanitize(run.configurationSnapshot ?? {}),
    finalMetrics: sanitize(run.finalMetrics ?? {}),
    snapshots: sanitize(run.snapshots ?? []),
  };
}

export function escapeCsv(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function flatten(value, prefix = '', rows = []) {
  for (const [key, child] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child instanceof Date) rows.push([path, child.toISOString()]);
    else if (child && typeof child === 'object' && !Array.isArray(child))
      flatten(child, path, rows);
    else rows.push([path, Array.isArray(child) ? JSON.stringify(child) : child]);
  }
  return rows;
}

export function createRunCsv(run) {
  const exported = createRunExport(run);
  const rows = [['Section', 'Field', 'Value']];
  for (const section of ['metadata', 'configuration', 'finalMetrics']) {
    for (const [field, value] of flatten(exported[section])) rows.push([section, field, value]);
  }
  rows.push([], ['Snapshots']);
  const snapshotColumns = [
    ['capturedAt', 'Captured At'],
    ['elapsedMs', 'Elapsed ms'],
    ['totalRequests', 'Completed Requests'],
    ['successes', 'Successful Requests'],
    ['httpErrors', 'HTTP Errors'],
    ['networkErrors', 'Network Errors'],
    ['timedOutRequests', 'Timeouts'],
    ['rps', 'Completed Request Attempts / Second'],
    ['averageLatencyMs', 'Average Latency ms'],
    ['minLatencyMs', 'Minimum Latency ms'],
    ['maxLatencyMs', 'Maximum Latency ms'],
    ['p50LatencyMs', 'p50 Latency ms'],
    ['p95LatencyMs', 'p95 Latency ms'],
    ['activeVirtualUsers', 'Active Virtual Users'],
    ['runtime.cpuUtilizationPercent', 'Load Generator CPU %'],
    ['runtime.peakRssMb', 'Load Generator Peak RSS MB'],
    ['runtime.peakHeapUsedMb', 'Load Generator Peak Heap MB'],
    ['runtime.eventLoopDelayMeanMs', 'Load Generator Event Loop Mean ms'],
    ['runtime.eventLoopDelayP95Ms', 'Load Generator Event Loop p95 ms'],
    ['runtime.eventLoopDelayMaxMs', 'Load Generator Event Loop Max ms'],
  ];
  rows.push(snapshotColumns.map(([, label]) => label));
  for (const snapshot of exported.snapshots) {
    rows.push(
      snapshotColumns.map(([column]) => {
        if (column === 'capturedAt') {
          return snapshot.capturedAt instanceof Date
            ? snapshot.capturedAt.toISOString()
            : snapshot.capturedAt;
        }
        return column.split('.').reduce((value, part) => value?.[part], snapshot.metrics ?? {});
      }),
    );
  }
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`;
}

function exportFilename(run, extension) {
  const date = new Date(run.finishedAt ?? run.startedAt ?? run.queuedAt);
  const safeDate = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  return `loadlab-run-${safeDate}.${extension}`;
}

export async function compareRuns(req, res, next) {
  try {
    const { runA, runB } = req.query;
    requireRunId(runA);
    requireRunId(runB);
    if (runA === runB) {
      throw createHttpError(400, 'SAME_RUN_COMPARISON', 'Select two different runs.');
    }
    const runs = await TestRun.find({
      _id: { $in: [runA, runB] },
      owner: req.auth.userId,
    }).lean();
    if (runs.length !== 2) {
      throw createHttpError(404, 'RUN_NOT_FOUND', 'One or more runs were not found.');
    }
    const ordered = [runA, runB].map((id) => runs.find((run) => String(run._id) === id));
    if (ordered.some((run) => run.status !== RUN_STATUS.COMPLETED)) {
      throw createHttpError(409, 'RUN_NOT_COMPLETED', 'Only completed runs can be compared.');
    }
    if (ordered.some((run) => !run.finalMetrics)) {
      throw createHttpError(
        409,
        'RUN_METRICS_UNAVAILABLE',
        'Completed run metrics are unavailable.',
      );
    }
    return res.json({
      comparison: {
        runA: comparisonRun(ordered[0]),
        runB: comparisonRun(ordered[1]),
        deltas: calculateRunDeltas(ordered[0], ordered[1]),
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function exportRun(req, res, next) {
  try {
    requireRunId(req.params.runId);
    if (!['json', 'csv'].includes(req.query.format)) {
      throw createHttpError(400, 'INVALID_EXPORT_FORMAT', 'Choose JSON or CSV export format.');
    }
    const run = await TestRun.findOne({
      _id: req.params.runId,
      owner: req.auth.userId,
    }).lean();
    if (!run) throw createHttpError(404, 'RUN_NOT_FOUND', 'Test run was not found.');
    if (run.status !== RUN_STATUS.COMPLETED) {
      throw createHttpError(409, 'RUN_NOT_COMPLETED', 'Only completed runs can be exported.');
    }
    if (!run.finalMetrics) {
      throw createHttpError(
        409,
        'RUN_METRICS_UNAVAILABLE',
        'Completed run metrics are unavailable.',
      );
    }
    const format = req.query.format;
    res.attachment(exportFilename(run, format));
    if (format === 'csv') return res.type('text/csv').send(createRunCsv(run));
    return res.type('application/json').send(JSON.stringify(createRunExport(run), null, 2));
  } catch (error) {
    return next(error);
  }
}

function overviewRun(run) {
  return {
    _id: run._id,
    plan: run.plan,
    status: run.status,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    configurationSnapshot: runConfiguration(run),
    name: run.configurationSnapshot?.name ?? 'Deleted plan',
    finalMetrics: run.finalMetrics,
  };
}

export async function getOverview(req, res, next) {
  try {
    const owner = req.auth.userId;
    const [completedRuns, failedRuns, cancelledRuns, verifiedTargets, recent, latestCompleted] =
      await Promise.all([
        TestRun.countDocuments({ owner, status: RUN_STATUS.COMPLETED }),
        TestRun.countDocuments({ owner, status: RUN_STATUS.FAILED }),
        TestRun.countDocuments({ owner, status: RUN_STATUS.CANCELLED }),
        Target.countDocuments({ owner, status: TARGET_STATUS.VERIFIED }),
        TestRun.find({ owner }).sort({ createdAt: -1 }).limit(20).lean(),
        TestRun.findOne({ owner, status: RUN_STATUS.COMPLETED })
          .sort({ finishedAt: -1, createdAt: -1 })
          .lean(),
      ]);
    const recentPlans = [];
    const seenPlans = new Set();
    for (const run of recent) {
      const planId = String(run.plan?._id ?? run.plan);
      if (!seenPlans.has(planId)) {
        seenPlans.add(planId);
        recentPlans.push({
          planId,
          name: run.configurationSnapshot?.name ?? 'Deleted plan',
          lastUsedAt: run.startedAt ?? run.queuedAt,
        });
      }
      if (recentPlans.length === 5) break;
    }
    return res.json({
      overview: {
        totals: { completedRuns, failedRuns, cancelledRuns, verifiedTargets },
        recentRuns: recent.slice(0, 5).map(overviewRun),
        latestPerformance: latestCompleted
          ? {
              runId: String(latestCompleted._id),
              rps: number(latestCompleted.finalMetrics?.rps),
              p95LatencyMs: number(latestCompleted.finalMetrics?.p95LatencyMs),
            }
          : null,
        recentPlans,
      },
    });
  } catch (error) {
    return next(error);
  }
}
