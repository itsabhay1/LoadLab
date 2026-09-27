import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { metricSeries } from '../utils/metrics';

export function MetricsChart({ run }) {
  const data = metricSeries(run);
  if (data.length === 0) {
    return <div className="chart-empty">Metrics will appear after the test begins.</div>;
  }
  return (
    <div className="metrics-chart" aria-label="RPS and p95 latency over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="elapsedMs"
            tickFormatter={(value) => `${Math.round(value / 1000)}s`}
            stroke="var(--muted-foreground)"
            fontSize={11}
          />
          <YAxis yAxisId="rps" stroke="var(--muted-foreground)" fontSize={11} />
          <YAxis
            yAxisId="latency"
            orientation="right"
            stroke="var(--muted-foreground)"
            fontSize={11}
          />
          <Tooltip
            labelFormatter={(value) => `${(value / 1000).toFixed(1)} seconds`}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          />
          <Legend />
          <Line
            yAxisId="rps"
            type="monotone"
            dataKey="rps"
            name="RPS"
            stroke="var(--primary)"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="latency"
            type="monotone"
            dataKey="p95LatencyMs"
            name="p95 latency (ms)"
            stroke="#c47732"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
