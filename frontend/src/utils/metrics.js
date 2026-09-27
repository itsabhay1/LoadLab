export const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);

export function errorRate(metrics) {
  if (!metrics?.totalRequests) return 0;
  return ((metrics.httpErrors + metrics.networkErrors) / metrics.totalRequests) * 100;
}

export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

export function latestMetrics(run) {
  return run?.liveMetrics ?? run?.finalMetrics ?? run?.snapshots?.at(-1)?.metrics;
}

export function metricSeries(run) {
  const persisted = (run?.snapshots ?? []).map((snapshot) => ({
    capturedAt: snapshot.capturedAt,
    ...snapshot.metrics,
  }));
  const terminalMetrics = run?.liveMetrics ?? run?.finalMetrics;
  if (!terminalMetrics) return persisted;

  const last = persisted.at(-1);
  const sameMetrics =
    last?.elapsedMs === terminalMetrics.elapsedMs &&
    last?.totalRequests === terminalMetrics.totalRequests &&
    last?.p95LatencyMs === terminalMetrics.p95LatencyMs &&
    last?.rps === terminalMetrics.rps;
  if (sameMetrics) return persisted;

  return [
    ...persisted,
    {
      capturedAt: run?.finishedAt ?? new Date().toISOString(),
      ...terminalMetrics,
    },
  ];
}

export function runProgress(run) {
  const metrics = latestMetrics(run);
  const duration = run?.configurationSnapshot?.durationMs;
  if (!duration || !metrics) return run?.status === 'COMPLETED' ? 100 : 0;
  return Math.min(100, Math.max(0, (metrics.elapsedMs / duration) * 100));
}
