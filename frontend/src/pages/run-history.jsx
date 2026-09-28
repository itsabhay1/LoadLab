import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, History, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { PageMessage, StatusBadge } from '../components/run-widgets';
import { api } from '../services/api';
import {
  ACTIVE_STATUSES,
  errorRate,
  formatNumber,
  latestMetrics,
  RPS_HELP,
} from '../utils/metrics';

const PAGE_SIZE = 20;

export function RunHistory() {
  const [runs, setRuns] = useState([]);
  const [plans, setPlans] = useState([]);
  const [targets, setTargets] = useState([]);
  const [filters, setFilters] = useState({ status: '', planId: '', targetId: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.listRuns({ ...filters, page, limit: PAGE_SIZE, signal: controller.signal }),
      api.listPlans({ signal: controller.signal }),
      api.listTargets({ signal: controller.signal }),
    ])
      .then(([runResponse, planResponse, targetResponse]) => {
        setRuns(runResponse.runs);
        setPagination(
          runResponse.pagination ?? {
            page,
            pages: runResponse.runs.length === PAGE_SIZE ? page + 1 : page,
            total: runResponse.runs.length,
          },
        );
        setPlans(planResponse.plans);
        setTargets(targetResponse.targets);
        setError(undefined);
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters, page]);

  const changeFilter = ({ target }) => {
    setPage(1);
    setFilters((current) => ({ ...current, [target.name]: target.value }));
  };
  const clearFilters = () => {
    setPage(1);
    setFilters({ status: '', planId: '', targetId: '', sort: 'newest' });
  };

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESULTS</p>
          <h1>Run history</h1>
          <p className="page-subtitle">Filter and inspect bounded pages of persisted test runs.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/compare">Compare completed runs</Link>
        </Button>
      </div>
      <div className="history-filters" aria-label="Run history filters">
        <SlidersHorizontal aria-hidden="true" />
        <label className="field">
          Status
          <select name="status" value={filters.status} onChange={changeFilter}>
            <option value="">All</option>
            {['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RUNNING', 'QUEUED'].map(
              (status) => (
                <option key={status}>{status}</option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          Test plan
          <select name="planId" value={filters.planId} onChange={changeFilter}>
            <option value="">All plans</option>
            {plans.map((plan) => (
              <option key={plan._id} value={plan._id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Target
          <select name="targetId" value={filters.targetId} onChange={changeFilter}>
            <option value="">All targets</option>
            {targets.map((target) => (
              <option key={target._id} value={target._id}>
                {target.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Sort
          <select name="sort" value={filters.sort} onChange={changeFilter}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <Button variant="ghost" type="button" onClick={clearFilters}>
          Clear filters
        </Button>
      </div>
      {loading ? (
        <PageMessage title="Loading run history" />
      ) : error ? (
        <PageMessage title="Could not load run history" tone="error">
          {error.message}
        </PageMessage>
      ) : runs.length === 0 ? (
        <PageMessage title="No runs match these filters">
          Clear the filters or start another test plan.
        </PageMessage>
      ) : (
        <>
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
                        <small title={RPS_HELP}>RPS</small>
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
          <div className="history-pagination">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              <ArrowLeft /> Previous
            </Button>
            <span>
              Page {pagination.page} of {Math.max(1, pagination.pages)} · {pagination.total} runs
            </span>
            <Button
              variant="outline"
              disabled={page >= pagination.pages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next <ArrowRight />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
