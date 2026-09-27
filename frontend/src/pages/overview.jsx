import {
  ArrowRight,
  Check,
  Circle,
  Code2,
  Database,
  FlaskConical,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

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
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR API PERFORMANCE WORKSPACE</p>
          <h1>Workspace overview</h1>
          <p className="page-subtitle">
            A solid foundation for your next performance breakthrough.
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
            PHASE 01 / FOUNDATION
          </span>
          <h2 id="welcome-title">
            Great performance starts
            <br className="hidden sm:block" /> with the right foundation.
          </h2>
          <p>
            Your LoadLab workspace is taking shape. Connect your API and database to get the
            essentials ready for what comes next.
          </p>
          <Button asChild className="welcome-button">
            <Link to="/setup">
              Set up your workspace
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <div
          className="system-map"
          aria-label="Architecture: web client connects to Express API, which connects to MongoDB"
        >
          <div className="map-label">THE FOUNDATION STACK</div>
          <div className="map-node">
            <Code2 />
            <span>
              Web client<small>React + Vite</small>
            </span>
            <span className="map-node-tag">UI</span>
          </div>
          <div className="map-line" />
          <div className="map-node">
            <Server />
            <span>
              API service<small>Node.js + Express</small>
            </span>
            <span className="map-node-tag">API</span>
          </div>
          <div className="map-line" />
          <div className="map-node">
            <Database />
            <span>
              Database<small>MongoDB Atlas</small>
            </span>
            <span className="map-node-tag">DB</span>
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
            description="Connection and live ping to your MongoDB database."
          />
        </div>
      </section>
      <div className="lower-grid">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Load testing</CardTitle>
              <span className="neutral-badge">COMING NEXT</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="empty-tests">
              <div className="empty-icon">
                <FlaskConical size={27} />
              </div>
              <h3>Your first test starts here.</h3>
              <p>
                Configure requests, simulate concurrent users and understand how your API performs
                under pressure.
              </p>
              <span className="text-xs text-muted-foreground">
                Test creation arrives in a future phase.
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Foundation checklist</CardTitle>
            <p className="text-sm text-muted-foreground">
              The essentials, before the first request.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="checklist">
              <li>
                <Check />
                <span>
                  Dashboard shell<small>Responsive workspace, light & dark themes</small>
                </span>
                <span className="check-label">Ready</span>
              </li>
              <li>
                {health?.status === 'fulfilled' ? <Check /> : <Circle />}
                <span>
                  API connection<small>Live process health check</small>
                </span>
                <span className="check-label">
                  {!health ? 'Checking' : health.status === 'fulfilled' ? 'Ready' : 'Check setup'}
                </span>
              </li>
              <li>
                {ready?.status === 'fulfilled' ? <Check /> : <Circle />}
                <span>
                  Database connection<small>Verified with a real database ping</small>
                </span>
                <span className="check-label">
                  {!ready ? 'Checking' : ready.status === 'fulfilled' ? 'Ready' : 'Check setup'}
                </span>
              </li>
            </ul>
            <Link className="setup-link" to="/setup">
              <Terminal size={15} />
              View local setup instructions
              <ArrowRight size={15} />
            </Link>
          </CardContent>
        </Card>
      </div>
      <p className="foundation-footnote">
        <ShieldCheck size={15} />
        Foundation release. Load generation, authentication and analytics are planned.
      </p>
    </div>
  );
}
