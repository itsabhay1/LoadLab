import { useEffect, useMemo, useState } from 'react';
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
import { GitCompareArrows } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { GENERATOR_HELP, PageMessage } from '../components/run-widgets';
import { api } from '../services/api';
import { formatDuration, formatNumber, metricSeries, RPS_HELP } from '../utils/metrics';

const CONFIGURATION_ROWS = [
  ['target', 'Target'],
  ['method', 'HTTP method'],
  ['endpoint', 'Endpoint'],
  ['virtualUsers', 'Virtual users'],
  ['durationMs', 'Duration', formatDuration],
  ['rampUpMs', 'Ramp-up', formatDuration],
  ['maxConnections', 'Connections'],
  ['requestsPerSecond', 'Request starts / sec'],
  ['requestTimeoutMs', 'Timeout', formatDuration],
];

const PERFORMANCE_METRIC_ROWS = [
  ['completedRequests', 'Completed requests', 0],
  ['successfulRequests', 'Successful requests', 0],
  ['httpErrors', 'HTTP errors', 0],
  ['networkErrors', 'Network errors', 0],
  ['timeouts', 'Timeouts', 0],
  ['rps', 'RPS', 2],
  ['averageLatencyMs', 'Average latency (ms)', 2],
  ['minLatencyMs', 'Minimum latency (ms)', 2],
  ['maxLatencyMs', 'Maximum latency (ms)', 2],
  ['p50LatencyMs', 'p50 (ms)', 2],
  ['p95LatencyMs', 'p95 (ms)', 2],
  ['peakVirtualUsers', 'Peak virtual users', 0],
  ['errorRatePercent', 'Error rate (%)', 2],
];

const GENERATOR_METRIC_ROWS = [
  ['cpuUtilizationPercent', 'Load Generator CPU (%)', 2],
  ['peakRssMb', 'Load Generator Peak Memory (MB)', 2],
  ['peakHeapUsedMb', 'Load Generator Heap (MB)', 2],
  ['eventLoopDelayMeanMs', 'Load Generator Event Loop Mean (ms)', 2],
  ['eventLoopDelayP95Ms', 'Load Generator Event Loop p95 (ms)', 2],
  ['eventLoopDelayMaxMs', 'Load Generator Event Loop Max (ms)', 2],
];

function mergeTimelines(runA, runB) {
  const points = new Map();
  for (const [prefix, run] of [
    ['a', runA],
    ['b', runB],
  ]) {
    for (const point of metricSeries(run)) {
      const elapsedMs = Number(point.elapsedMs);
      if (!Number.isFinite(elapsedMs)) continue;
      const merged = points.get(elapsedMs) ?? { elapsedMs };
      merged[`${prefix}Rps`] = point.rps;
      merged[`${prefix}P95`] = point.p95LatencyMs;
      points.set(elapsedMs, merged);
    }
  }
  return [...points.values()].sort((left, right) => left.elapsedMs - right.elapsedMs);
}

function Delta({ label, value, suffix = '' }) {
  return (
    <Card className="comparison-delta">
      <CardContent>
        <small>{label}</small>
        <strong>{value === null ? 'Undefined' : `${formatNumber(value, 2)}${suffix}`}</strong>
        <span>Run B minus Run A</span>
      </CardContent>
    </Card>
  );
}

export function RunComparison() {
  const [runs, setRuns] = useState([]);
  const [runA, setRunA] = useState('');
  const [runB, setRunB] = useState('');
  const [comparison, setComparison] = useState();
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState();

  useEffect(() => {
    const controller = new AbortController();
    api
      .listRuns({ status: 'COMPLETED', sort: 'newest', limit: 50, signal: controller.signal })
      .then(({ runs: completed }) => {
        setRuns(completed);
        setRunA(completed[0]?._id ?? '');
        setRunB(completed[1]?._id ?? '');
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const timeline = useMemo(
    () => (comparison ? mergeTimelines(comparison.runA, comparison.runB) : []),
    [comparison],
  );

  const compare = async (event) => {
    event.preventDefault();
    setComparing(true);
    setError(undefined);
    try {
      const response = await api.compareRuns(runA, runB);
      setComparison(response.comparison);
    } catch (compareError) {
      setComparison(undefined);
      setError(compareError);
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERFORMANCE ANALYSIS</p>
          <h1>Compare runs</h1>
          <p className="page-subtitle">Compare two completed runs without assigning a score.</p>
        </div>
      </div>
      {loading ? (
        <PageMessage title="Loading completed runs" />
      ) : runs.length < 2 ? (
        <PageMessage title="Two completed runs are required">
          Complete at least two tests before creating a comparison.
        </PageMessage>
      ) : (
        <form className="comparison-picker" onSubmit={compare}>
          <label className="field">
            Run A
            <select value={runA} onChange={(event) => setRunA(event.target.value)}>
              {runs.map((run) => (
                <option key={run._id} value={run._id}>
                  {run.configurationSnapshot.name} — {new Date(run.finishedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Run B
            <select value={runB} onChange={(event) => setRunB(event.target.value)}>
              {runs.map((run) => (
                <option key={run._id} value={run._id}>
                  {run.configurationSnapshot.name} — {new Date(run.finishedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={comparing || !runA || !runB || runA === runB}>
            <GitCompareArrows /> {comparing ? 'Comparing…' : 'Compare'}
          </Button>
        </form>
      )}
      {error && (
        <PageMessage title="Could not compare runs" tone="error">
          {error.message}
        </PageMessage>
      )}
      {comparison && (
        <>
          <div className="comparison-deltas">
            <Delta label="RPS difference" value={comparison.deltas.rpsDifference} />
            <Delta
              label="RPS percentage change"
              value={comparison.deltas.rpsPercentageChange}
              suffix="%"
            />
            <Delta label="p50 difference" value={comparison.deltas.p50DifferenceMs} suffix=" ms" />
            <Delta label="p95 difference" value={comparison.deltas.p95DifferenceMs} suffix=" ms" />
            <Delta
              label="Error-rate difference"
              value={comparison.deltas.errorRateDifferencePoints}
              suffix=" pp"
            />
          </div>
          <Card className="comparison-card">
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="comparison-table">
                <div className="comparison-heading">Field</div>
                <div className="comparison-heading">Run A · {comparison.runA.name}</div>
                <div className="comparison-heading">Run B · {comparison.runB.name}</div>
                {CONFIGURATION_ROWS.map(([key, label, formatter]) => (
                  <div className="comparison-row" key={key}>
                    <strong>{label}</strong>
                    <span>
                      {formatter
                        ? formatter(comparison.runA.configuration[key])
                        : comparison.runA.configuration[key]}
                    </span>
                    <span>
                      {formatter
                        ? formatter(comparison.runB.configuration[key])
                        : comparison.runB.configuration[key]}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="comparison-card">
            <CardHeader>
              <CardTitle>Target/API Performance</CardTitle>
              <p className="comparison-note">{RPS_HELP}</p>
            </CardHeader>
            <CardContent>
              <div className="comparison-table">
                <div className="comparison-heading">Metric</div>
                <div className="comparison-heading">Run A</div>
                <div className="comparison-heading">Run B</div>
                {PERFORMANCE_METRIC_ROWS.map(([key, label, digits]) => (
                  <div className="comparison-row" key={key}>
                    <strong>{label}</strong>
                    <span>{formatNumber(comparison.runA.metrics[key], digits)}</span>
                    <span>{formatNumber(comparison.runB.metrics[key], digits)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="comparison-card generator-comparison-card">
            <CardHeader>
              <CardTitle>Load Generator Health</CardTitle>
              <p className="comparison-note">{GENERATOR_HELP}</p>
            </CardHeader>
            <CardContent>
              <div className="comparison-table">
                <div className="comparison-heading">Metric</div>
                <div className="comparison-heading">Run A</div>
                <div className="comparison-heading">Run B</div>
                {GENERATOR_METRIC_ROWS.map(([key, label, digits]) => (
                  <div className="comparison-row" key={key}>
                    <strong>{label}</strong>
                    <span>{formatNumber(comparison.runA.metrics[key], digits)}</span>
                    <span>{formatNumber(comparison.runB.metrics[key], digits)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="comparison-card">
            <CardHeader>
              <CardTitle>Elapsed-time overlay</CardTitle>
              <p className="comparison-note">
                Each run uses its own elapsed timeline. Missing snapshots are left missing.
              </p>
            </CardHeader>
            <CardContent>
              {timeline.length ? (
                <div className="metrics-chart" aria-label="Run comparison over elapsed time">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeline} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="elapsedMs"
                        tickFormatter={(value) => `${Math.round(value / 1000)}s`}
                      />
                      <YAxis yAxisId="rps" />
                      <YAxis yAxisId="latency" orientation="right" />
                      <Tooltip labelFormatter={(value) => `${(value / 1000).toFixed(1)} seconds`} />
                      <Legend />
                      <Line
                        yAxisId="rps"
                        dataKey="aRps"
                        name="Run A RPS"
                        stroke="var(--primary)"
                        dot={false}
                        connectNulls
                      />
                      <Line
                        yAxisId="rps"
                        dataKey="bRps"
                        name="Run B RPS"
                        stroke="#7559b7"
                        dot={false}
                        connectNulls
                      />
                      <Line
                        yAxisId="latency"
                        dataKey="aP95"
                        name="Run A p95"
                        stroke="#c47732"
                        dot={false}
                        connectNulls
                      />
                      <Line
                        yAxisId="latency"
                        dataKey="bP95"
                        name="Run B p95"
                        stroke="#3a8a89"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="chart-empty">No persisted snapshots are available to overlay.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
