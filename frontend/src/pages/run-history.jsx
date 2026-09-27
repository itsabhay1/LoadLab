import { useEffect, useState } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { PageMessage, StatusBadge } from '../components/run-widgets';
import { api } from '../services/api';
import { ACTIVE_STATUSES, errorRate, formatNumber, latestMetrics } from '../utils/metrics';

export function RunHistory() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState();
  useEffect(() => {
    const controller = new AbortController();
    api
      .listRuns({ signal: controller.signal })
      .then(({ runs: data }) => setRuns(data))
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESULTS</p>
          <h1>Run history</h1>
          <p className="page-subtitle">
            Stored results and bounded metric snapshots from every test.
          </p>
        </div>
      </div>
      {loading ? (
        <PageMessage title="Loading run history" />
      ) : error ? (
        <PageMessage title="Could not load run history" tone="error">
          {error.message}
        </PageMessage>
      ) : runs.length === 0 ? (
        <PageMessage title="No test runs yet">
          Start a test plan to collect real performance metrics.
        </PageMessage>
      ) : (
        <div className="history-list">
          {runs.map((run) => {
            const metrics = latestMetrics(run);
            const active = ACTIVE_STATUSES.has(run.status);
            return (
              <Card key={run._id} className="history-row">
                <CardContent>
                  <span className="history-icon">
                    <History />
                  </span>
                  <div className="history-main">
                    <div className="flex items-center gap-3 flex-wrap">
                      <strong>{run.configurationSnapshot.name}</strong>
                      <StatusBadge status={run.status} />
                    </div>
                    <span>
                      {new Date(run.queuedAt).toLocaleString()} ·{' '}
                      {run.configurationSnapshot.virtualUsers} VUs ·{' '}
                      {run.configurationSnapshot.targetUrl}
                    </span>
                  </div>
                  <div className="history-metrics">
                    <span>
                      <small>RPS</small>
                      {formatNumber(metrics?.rps, 1)}
                    </span>
                    <span>
                      <small>p95</small>
                      {metrics ? `${formatNumber(metrics.p95LatencyMs, 1)} ms` : '—'}
                    </span>
                    <span>
                      <small>Errors</small>
                      {metrics ? `${formatNumber(errorRate(metrics), 2)}%` : '—'}
                    </span>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={active ? `/runs/${run._id}/live` : `/runs/${run._id}`}>
                      {active ? 'Open live' : 'View details'}
                      <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
