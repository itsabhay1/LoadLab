import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Circle,
  Database,
  FlaskConical,
  Radio,
  RefreshCw,
  Server,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/run-widgets';
import { api } from '../services/api';
import { ACTIVE_STATUSES, formatNumber, latestMetrics } from '../utils/metrics';

function ServiceCard({ icon: Icon, title, endpoint, result, loading, description }) {
  const success = result?.status === 'fulfilled';
  const label = !result ? 'Checking' : success ? 'Connected' : 'Unavailable';
  return (
    <Card className="service-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <span className="service-icon">
            <Icon size={20} />
          </span>
          <span className={`status-pill ${success ? 'success' : result ? 'warning' : ''}`}>
            <span className={`status-dot ${success ? 'online' : result ? 'offline' : 'pending'}`} />
            {label}
          </span>
        </div>
        <CardTitle className="mt-5">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="service-description">{description}</p>
        <div className="endpoint">
          <code>GET {endpoint}</code>
          {loading ? (
            <RefreshCw size={14} className="animate-spin" aria-label="Checking" />
          ) : success ? (
            <Check size={15} />
          ) : (
            <Circle size={13} />
          )}
        </div>
        {result?.status === 'rejected' && (
          <div className="service-error">
            <p>{result.reason.message}</p>
            {result.reason.requestId && (
              <p className="request-id">Request ID: {result.reason.requestId}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Overview() {
  const { health, ready, loading, checkedAt, refresh } = useOutletContext();
  const [summary, setSummary] = useState({ plans: [], runs: [] });
  const [summaryError, setSummaryError] = useState();
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.listPlans({ signal: controller.signal }),
      api.listRuns({ signal: controller.signal }),
    ])
      .then(([plans, runs]) => setSummary({ plans: plans.plans, runs: runs.runs }))
      .catch((error) => {
        if (error.name !== 'AbortError') setSummaryError(error);
      });
    return () => controller.abort();
  }, []);
  const latestRun = summary.runs[0];
  const metrics = latestMetrics(latestRun);
  const active = latestRun && ACTIVE_STATUSES.has(latestRun.status);
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR API PERFORMANCE WORKSPACE</p>
          <h1>Workspace overview</h1>
          <p className="page-subtitle">
            Plan, run and inspect local performance tests from one dashboard.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {loading ? 'Checking services…' : 'Refresh status'}
        </Button>
      </div>
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <span className="welcome-tag">
            <span className="status-dot" />
            LIVE TESTING WORKSPACE
          </span>
          <h2 id="welcome-title">
            Measure your local API
            <br className="hidden sm:block" /> with real load.
          </h2>
          <p>
            Create controlled tests, watch aggregate metrics as they run and keep results in MongoDB
            for later review.
          </p>
          <Button asChild className="welcome-button">
            <Link to="/plans">
              Create a test plan
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="system-map" aria-label="React dashboard connects to Express and MongoDB">
          <div className="map-label">LOADLAB PIPELINE</div>
          <div className="map-node">
            <FlaskConical />
            <span>
              Test plan<small>Safe local target</small>
            </span>
            <span className="map-node-tag">PLAN</span>
          </div>
          <div className="map-line" />
          <div className="map-node">
            <Server />
            <span>
              Load engine<small>Up to 1000 VUs</small>
            </span>
            <span className="map-node-tag">RUN</span>
          </div>
          <div className="map-line" />
          <div className="map-node">
            <Database />
            <span>
              Run history<small>MongoDB aggregates</small>
            </span>
            <span className="map-node-tag">DATA</span>
          </div>
        </div>
      </section>
      <section aria-labelledby="services-title">
        <div className="section-heading">
          <h2 id="services-title">Service connections</h2>
          <span aria-live="polite">
            {checkedAt
              ? `Last checked ${checkedAt.toLocaleTimeString()}`
              : 'Checking your services…'}
            <span className="auto-refresh"> · every 15s</span>
          </span>
        </div>
        <div className="service-grid">
          <ServiceCard
            icon={Radio}
            title="API server"
            endpoint="/api/v1/health"
            result={health}
            loading={loading}
            description="Process liveness from your Express backend."
          />
          <ServiceCard
            icon={Database}
            title="Database readiness"
            endpoint="/api/v1/ready"
            result={ready}
            loading={loading}
            description="Connection and live ping to MongoDB Atlas."
          />
        </div>
      </section>
      <div className="overview-stats">
        <Card>
          <CardContent>
            <small>Test plans</small>
            <strong>{summaryError ? '—' : summary.plans.length}</strong>
            <Link to="/plans">
              Manage plans <ArrowRight />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <small>Stored runs</small>
            <strong>{summaryError ? '—' : summary.runs.length}</strong>
            <Link to="/history">
              View history <ArrowRight />
            </Link>
          </CardContent>
        </Card>
        <Card className="latest-run-card">
          <CardContent>
            <div>
              <small>Latest run</small>
              {latestRun ? (
                <>
                  <div className="flex items-center gap-3 mt-2">
                    <strong>{latestRun.configurationSnapshot.name}</strong>
                    <StatusBadge status={latestRun.status} />
                  </div>
                  <span>
                    {metrics
                      ? `${formatNumber(metrics.rps, 1)} RPS · ${formatNumber(metrics.p95LatencyMs, 1)} ms p95`
                      : 'Waiting for metrics'}
                  </span>
                </>
              ) : (
                <strong>No runs yet</strong>
              )}
            </div>
            {latestRun && (
              <Button asChild variant="outline" size="sm">
                <Link to={active ? `/runs/${latestRun._id}/live` : `/runs/${latestRun._id}`}>
                  Open
                  <ArrowRight />
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      {summaryError && (
        <p className="summary-error" role="alert">
          Run summary unavailable: {summaryError.message}
        </p>
      )}
    </div>
  );
}
