import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { MetricGrid, PageMessage, StatusBadge } from '../components/run-widgets';
import { MetricsChart } from '../components/metrics-chart';
import { api } from '../services/api';
import { formatDuration, latestMetrics } from '../utils/metrics';

export function RunDetails() {
  const { runId } = useParams();
  const [run, setRun] = useState();
  const [error, setError] = useState();
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
  if (error)
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
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COMPLETED RUN</p>
          <div className="title-with-status">
            <h1>{run.configurationSnapshot.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="page-subtitle">{run.configurationSnapshot.targetUrl}</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/history">
            <ArrowLeft />
            Run history
          </Link>
        </Button>
      </div>
      {run.reason && <PageMessage title="Run note">{run.reason}</PageMessage>}
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
                <dt>Virtual users</dt>
                <dd>{run.configurationSnapshot.virtualUsers}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(run.configurationSnapshot.durationMs)}</dd>
              </div>
              <div>
                <dt>Ramp-up</dt>
                <dd>{formatDuration(run.configurationSnapshot.rampUpMs)}</dd>
              </div>
              <div>
                <dt>Request timeout</dt>
                <dd>{formatDuration(run.configurationSnapshot.requestTimeoutMs)}</dd>
              </div>
              <div>
                <dt>Connections</dt>
                <dd>{run.configurationSnapshot.maxConnections}</dd>
              </div>
              <div>
                <dt>Request rate limit</dt>
                <dd>{run.configurationSnapshot.requestsPerSecond}/s</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
