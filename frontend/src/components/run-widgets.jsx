import { Activity, Clock3, Gauge, UsersRound } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { errorRate, formatNumber } from '../utils/metrics';

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
    <div className="metric-grid">
      {items.map(([label, value, Icon, digits, suffix = '']) => (
        <Card key={label} className="metric-card">
          <CardContent>
            <span className="metric-icon">
              <Icon size={17} />
            </span>
            <span className="metric-label">{label}</span>
            <strong>{value === undefined ? '—' : `${formatNumber(value, digits)}${suffix}`}</strong>
          </CardContent>
        </Card>
      ))}
    </div>
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
