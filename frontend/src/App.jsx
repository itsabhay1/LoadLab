import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { DashboardLayout } from './components/dashboard-layout';
import { NotFound } from './pages/not-found';
import { Overview } from './pages/overview';
import { TestPlans } from './pages/test-plans';
import { Targets } from './pages/targets';
import { RunHistory } from './pages/run-history';
import { Login } from './pages/login';
import { Register } from './pages/register';
import { ProtectedRoute } from './components/protected-route';
import { RouteTitle } from './components/route-title';

const RunDetails = lazy(() =>
  import('./pages/run-details').then((module) => ({ default: module.RunDetails })),
);
const LiveRun = lazy(() =>
  import('./pages/live-run').then((module) => ({ default: module.LiveRun })),
);
const RunComparison = lazy(() =>
  import('./pages/run-comparison').then((module) => ({ default: module.RunComparison })),
);

export function App() {
  return (
    <>
      <RouteTitle />
      <Suspense
        fallback={
          <div className="page-content">
            <p className="page-message">Loading workspace…</p>
          </div>
        }
      >
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<DashboardLayout />}>
              <Route index element={<Overview />} />
              <Route path="plans" element={<TestPlans />} />
              <Route path="targets" element={<Targets />} />
              <Route path="history" element={<RunHistory />} />
              <Route path="compare" element={<RunComparison />} />
              <Route path="runs/:runId" element={<RunDetails />} />
              <Route path="runs/:runId/live" element={<LiveRun />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
