import { Activity, Clock3, Gauge, UsersRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { errorRate, formatNumber, RPS_HELP } from '../utils/metrics';

export const GENERATOR_HELP =
  'Resource usage of the LoadLab process generating traffic. These metrics help identify whether the load generator itself became a bottleneck. They do not represent CPU or memory usage of the target API server.';

export function StatusBadge({ status }) {
  return (
    <span className={`run-status status-${status?.toLowerCase()}`}>{status ?? 'UNKNOWN'}</span>
  );
}

export function MetricGrid({ metrics, activeUsersLabel = 'Active users' }) {
  const items = [
    ['Requests / sec', metrics?.rps, Gauge, 1],
    ['p50 latency', metrics?.p50LatencyMs, Clock3, 1, ' ms'],
    ['p95 latency', metrics?.p95LatencyMs, Clock3, 1, ' ms'],
    ['Error rate', metrics ? errorRate(metrics) : undefined, Activity, 2, '%'],
    ['Completed', metrics?.totalRequests, Activity, 0],
    [activeUsersLabel, metrics?.activeVirtualUsers, UsersRound, 0],
  ];
  return (
    <section className="metric-section" aria-labelledby="target-performance-heading">
      <div className="metric-section-heading">
        <h2 id="target-performance-heading">Target/API Performance</h2>
        <p>{RPS_HELP}</p>
      </div>
      <div className="metric-grid">
        {items.map(([label, value, Icon, digits, suffix = '']) => (
          <Card key={label} className="metric-card">
            <CardContent>
              <span className="metric-icon">
                <Icon size={17} />
              </span>
              <span
                className="metric-label"
                title={label === 'Requests / sec' ? RPS_HELP : undefined}
              >
                {label}
              </span>
              <strong>
                {value === undefined ? '—' : `${formatNumber(value, digits)}${suffix}`}
              </strong>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function RequestDetails({ metrics }) {
  const rows = [
    ['Successful requests', metrics?.successes, 0],
    ['HTTP errors', metrics?.httpErrors, 0],
    ['Network errors', metrics?.networkErrors, 0],
    ['Timeouts', metrics?.timedOutRequests, 0],
    ['Average latency', metrics?.averageLatencyMs, 2, ' ms'],
    ['Minimum latency', metrics?.minLatencyMs, 2, ' ms'],
    ['Maximum latency', metrics?.maxLatencyMs, 2, ' ms'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request outcomes and latency</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="details-list">
          {rows.map(([label, value, digits, suffix = '']) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{Number.isFinite(value) ? `${formatNumber(value, digits)}${suffix}` : '—'}</dd>
            </div>
          ))}
          <div>
            <dt>Total error rate</dt>
            <dd>{metrics ? `${formatNumber(errorRate(metrics), 2)}%` : '—'}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function GeneratorHealth({ metrics }) {
  const runtime = metrics?.runtime;
  const rows = [
    ['Load Generator CPU', runtime?.cpuUtilizationPercent, '%'],
    ['Load Generator Peak Memory', runtime?.peakRssMb, ' MB'],
    ['Load Generator Heap', runtime?.peakHeapUsedMb, ' MB'],
    ['Load Generator Event Loop Mean', runtime?.eventLoopDelayMeanMs, ' ms'],
    ['Load Generator Event Loop p95', runtime?.eventLoopDelayP95Ms, ' ms'],
    ['Load Generator Event Loop Max', runtime?.eventLoopDelayMaxMs, ' ms'],
  ];
  return (
    <section className="generator-health" aria-labelledby="generator-health-heading">
      <div className="metric-section-heading">
        <h2 id="generator-health-heading">Load Generator Health</h2>
        <p>{GENERATOR_HELP}</p>
      </div>
      <Card className="generator-health-card">
        <CardContent>
          <dl className="generator-health-grid">
            {rows.map(([label, value, suffix]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{Number.isFinite(value) ? `${formatNumber(value, 2)}${suffix}` : '—'}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

export function PageMessage({ title, children, tone = '' }) {
  return (
    <div className={`page-message ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
