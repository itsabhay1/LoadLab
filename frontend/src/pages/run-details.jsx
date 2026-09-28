import { useEffect, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  GeneratorHealth,
  MetricGrid,
  PageMessage,
  RequestDetails,
  StatusBadge,
} from '../components/run-widgets';
import { MetricsChart } from '../components/metrics-chart';
import { api } from '../services/api';
import { formatDuration, latestMetrics } from '../utils/metrics';

function triggerDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function RunDetails() {
  const { runId } = useParams();
  const [run, setRun] = useState();
  const [error, setError] = useState();
  const [exporting, setExporting] = useState();
  useEffect(() => {
    const controller = new AbortController();
    api
      .getRun(runId, { signal: controller.signal })
      .then(({ run: data }) => setRun(data))
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError);
      });
    return () => controller.abort();
  }, [runId]);
  const download = async (format) => {
    setExporting(format);
    setError(undefined);
    try {
      triggerDownload(await api.exportRun(runId, format));
    } catch (exportError) {
      setError(exportError);
    } finally {
      setExporting(undefined);
    }
  };
  if (error && !run)
    return (
      <div className="page-content">
        <PageMessage title="Could not load this run" tone="error">
          {error.message}
        </PageMessage>
      </div>
    );
  if (!run)
    return (
      <div className="page-content">
        <PageMessage title="Loading run details" />
      </div>
    );
  const metrics = latestMetrics(run);
  const configuration = run.configurationSnapshot;
  let endpoint = configuration.targetUrl;
  try {
    const url = new URL(configuration.targetUrl);
    endpoint = `${url.pathname}${url.search}`;
  } catch {
    // Old run snapshots remain displayable even if their target was not a valid URL.
  }
  const elapsed =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : configuration.durationMs;
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COMPLETED RUN REPORT</p>
          <div className="title-with-status">
            <h1>{configuration.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="page-subtitle">{configuration.targetUrl}</p>
        </div>
        <div className="report-actions">
          {run.status === 'COMPLETED' && (
            <>
              <Button
                variant="outline"
                disabled={Boolean(exporting)}
                onClick={() => void download('json')}
              >
                <Download />
                {exporting === 'json' ? 'Exporting…' : 'JSON'}
              </Button>
              <Button
                variant="outline"
                disabled={Boolean(exporting)}
                onClick={() => void download('csv')}
              >
                <Download />
                {exporting === 'csv' ? 'Exporting…' : 'CSV'}
              </Button>
            </>
          )}
          <Button asChild variant="outline">
            <Link to="/history">
              <ArrowLeft />
              Run history
            </Link>
          </Button>
        </div>
      </div>
      {error && (
        <PageMessage title="Export failed" tone="error">
          {error.message}
        </PageMessage>
      )}
      {run.reason && <PageMessage title="Run note">{run.reason}</PageMessage>}
      {!metrics && (
        <PageMessage title="Metrics unavailable">
          This run does not contain final or snapshot metrics.
        </PageMessage>
      )}
      <MetricGrid metrics={metrics} activeUsersLabel="Peak virtual users" />
      <div className="details-grid">
        <Card>
          <CardHeader>
            <CardTitle>Performance over time</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricsChart run={run} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Run configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="details-list">
              <div>
                <dt>Target</dt>
                <dd>{configuration.targetUrl}</dd>
              </div>
              <div>
                <dt>HTTP method</dt>
                <dd>{configuration.method ?? 'GET'}</dd>
              </div>
              <div>
                <dt>Endpoint</dt>
                <dd>{endpoint}</dd>
              </div>
              <div>
                <dt>Virtual users</dt>
                <dd>{configuration.virtualUsers}</dd>
              </div>
              <div>
                <dt>Configured duration</dt>
                <dd>{formatDuration(configuration.durationMs)}</dd>
              </div>
              <div>
                <dt>Ramp-up</dt>
                <dd>{formatDuration(configuration.rampUpMs)}</dd>
              </div>
              <div>
                <dt>Request timeout</dt>
                <dd>{formatDuration(configuration.requestTimeoutMs)}</dd>
              </div>
              <div>
                <dt>Connections</dt>
                <dd>{configuration.maxConnections}</dd>
              </div>
              <div>
                <dt>Request-start rate</dt>
                <dd>{configuration.requestsPerSecond}/s</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
      <div className="report-grid">
        <RequestDetails metrics={metrics} />
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="details-list">
              <div>
                <dt>Started</dt>
                <dd>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—'}</dd>
              </div>
              <div>
                <dt>Elapsed duration</dt>
                <dd>{formatDuration(elapsed)}</dd>
              </div>
              <div>
                <dt>Stored snapshots</dt>
                <dd>{run.snapshots.length}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
      <GeneratorHealth metrics={metrics} />
    </div>
  );
}
