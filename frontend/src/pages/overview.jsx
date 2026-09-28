import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageMessage, StatusBadge } from '../components/run-widgets';
import { api } from '../services/api';
import { ACTIVE_STATUSES, errorRate, formatNumber, RPS_HELP } from '../utils/metrics';

const EMPTY_OVERVIEW = {
  totals: { completedRuns: 0, failedRuns: 0, cancelledRuns: 0, verifiedTargets: 0 },
  recentRuns: [],
  latestPerformance: null,
  recentPlans: [],
};

export function Overview() {
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState();
  useEffect(() => {
    const controller = new AbortController();
    api
      .overview({ signal: controller.signal })
      .then((response) => setOverview(response.overview))
      .catch((error) => {
        if (error.name !== 'AbortError') setSummaryError(error);
      })
      .finally(() => setSummaryLoading(false));
    return () => controller.abort();
  }, []);
  const latestRun = overview.latestPerformance
    ? overview.recentRuns.find((run) => run._id === overview.latestPerformance.runId)
    : undefined;
  const latestMetrics = latestRun?.finalMetrics;
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PERFORMANCE WORKSPACE</p>
          <h1>Workspace overview</h1>
          <p className="page-subtitle">Your persisted performance results at a glance.</p>
        </div>
      </div>
      <section className="welcome-panel overview-hero" aria-labelledby="overview-hero-title">
        <div className="welcome-copy">
          <p className="eyebrow">API PERFORMANCE TESTING</p>
          <h2 id="overview-hero-title">Load test verified APIs with confidence.</h2>
          <p>
            Simulate concurrent traffic, monitor live performance, and compare results with
            persisted metrics.
          </p>
          <Button asChild className="welcome-button">
            <Link to="/plans">
              Create a test plan <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
      {summaryLoading ? (
        <PageMessage title="Loading workspace analytics" />
      ) : summaryError ? (
        <PageMessage title="Workspace analytics unavailable" tone="error">
          {summaryError.message}
        </PageMessage>
      ) : (
        <>
          <div className="overview-stats overview-stats-four">
            {[
              ['Completed runs', overview.totals.completedRuns, '/history'],
              ['Failed runs', overview.totals.failedRuns, '/history'],
              ['Cancelled runs', overview.totals.cancelledRuns, '/history'],
              ['Verified targets', overview.totals.verifiedTargets, '/targets'],
            ].map(([label, value, href]) => (
              <Card key={label}>
                <CardContent>
                  <small>{label}</small>
                  <strong>{value}</strong>
                  <Link to={href}>
                    Open <ArrowRight />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="overview-analysis-grid">
            <Card>
              <CardHeader>
                <CardTitle>Latest completed performance</CardTitle>
              </CardHeader>
              <CardContent>
                {overview.latestPerformance ? (
                  <div className="latest-performance">
                    <span>
                      <small title={RPS_HELP}>RPS</small>
                      <strong>{formatNumber(overview.latestPerformance.rps, 2)}</strong>
                    </span>
                    <span>
                      <small>p95 latency</small>
                      <strong>{formatNumber(overview.latestPerformance.p95LatencyMs, 2)} ms</strong>
                    </span>
                    {latestMetrics && (
                      <>
                        <span>
                          <small>Error rate</small>
                          <strong>{formatNumber(errorRate(latestMetrics), 2)}%</strong>
                        </span>
                        <span>
                          <small>Peak virtual users</small>
                          <strong>{formatNumber(latestMetrics.activeVirtualUsers)}</strong>
                        </span>
                      </>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/runs/${overview.latestPerformance.runId}`}>Open report</Link>
                    </Button>
                  </div>
                ) : (
                  <p className="empty-inline">No completed-run metrics yet.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recently used test plans</CardTitle>
              </CardHeader>
              <CardContent>
                {overview.recentPlans.length ? (
                  <ul className="recent-plan-list">
                    {overview.recentPlans.map((plan) => (
                      <li key={plan.planId}>
                        <strong>{plan.name}</strong>
                        <span>{new Date(plan.lastUsedAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-inline">No plans have been run yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
          <section className="recent-runs" aria-labelledby="recent-runs-title">
            <div className="section-heading">
              <h2 id="recent-runs-title">Recent runs</h2>
              <Link to="/history">Full history</Link>
            </div>
            {overview.recentRuns.length ? (
              overview.recentRuns.map((run) => (
                <Link
                  className="recent-run-row"
                  to={
                    ACTIVE_STATUSES.has(run.status) ? `/runs/${run._id}/live` : `/runs/${run._id}`
                  }
                  key={run._id}
                >
                  <span>
                    <strong>{run.name}</strong>
                    <small>{new Date(run.queuedAt).toLocaleString()}</small>
                  </span>
                  <StatusBadge status={run.status} />
                  <ArrowRight />
                </Link>
              ))
            ) : (
              <p className="empty-inline">No runs yet</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
