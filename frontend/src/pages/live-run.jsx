import { useState } from 'react';
import { Radio, StopCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { MetricGrid, PageMessage, StatusBadge } from '../components/run-widgets';
import { MetricsChart } from '../components/metrics-chart';
import { useLiveRun } from '../hooks/use-live-run';
import { api } from '../services/api';
import { ACTIVE_STATUSES, runProgress } from '../utils/metrics';

export function LiveRun() {
  const { runId } = useParams();
  const { run, loading, error, connected, refresh } = useLiveRun(runId);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState();
  const cancel = async () => {
    setCancelling(true);
    setActionError(undefined);
    try {
      await api.cancelRun(runId);
      await refresh();
    } catch (cancelError) {
      setActionError(cancelError);
      setCancelling(false);
    }
  };
  if (loading && !run)
    return (
      <div className="page-content">
        <PageMessage title="Loading live test" />
      </div>
    );
  if (error && !run)
    return (
      <div className="page-content">
        <PageMessage title="Could not load the test" tone="error">
          {error.message}
        </PageMessage>
      </div>
    );
  const active = ACTIVE_STATUSES.has(run?.status);
  const progress = runProgress(run);
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="live-kicker">
            <Radio size={14} />
            {connected ? 'Live connection' : 'Reconnecting…'}
          </div>
          <div className="title-with-status">
            <h1>{run?.configurationSnapshot?.name ?? 'Test run'}</h1>
            <StatusBadge status={run?.status} />
          </div>
          <p className="page-subtitle">{run?.configurationSnapshot?.targetUrl}</p>
        </div>
        {active ? (
          <Button variant="outline" onClick={() => void cancel()} disabled={cancelling}>
            <StopCircle />
            {cancelling ? 'Cancelling…' : 'Cancel test'}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link to={`/runs/${runId}`}>View final details</Link>
          </Button>
        )}
      </div>
      {(error || actionError) && (
        <PageMessage title="Live synchronization issue" tone="error">
          {(actionError ?? error).message}
        </PageMessage>
      )}
      <div className="progress-panel">
        <div>
          <span>Test progress</span>
          <strong>{progress.toFixed(0)}%</strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <MetricGrid
        metrics={run?.liveMetrics ?? run?.finalMetrics ?? run?.snapshots?.at(-1)?.metrics}
      />
      <Card className="live-chart-card">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Live throughput and latency</CardTitle>
            <span className={`connection-state ${connected ? 'connected' : ''}`}>
              <span />
              {connected ? 'Streaming aggregates' : 'REST data shown'}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <MetricsChart run={run} />
        </CardContent>
      </Card>
      {run?.reason && <PageMessage title="Run note">{run.reason}</PageMessage>}
    </div>
  );
}
