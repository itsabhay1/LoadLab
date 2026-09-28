import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { DashboardLayout } from './components/dashboard-layout';
import { NotFound } from './pages/not-found';
import { Overview } from './pages/overview';
import { Setup } from './pages/setup';
import { TestPlans } from './pages/test-plans';
import { RunHistory } from './pages/run-history';
import { Login } from './pages/login';
import { Register } from './pages/register';
import { ProtectedRoute } from './components/protected-route';

const RunDetails = lazy(() =>
  import('./pages/run-details').then((module) => ({ default: module.RunDetails })),
);
const LiveRun = lazy(() =>
  import('./pages/live-run').then((module) => ({ default: module.LiveRun })),
);

export function App() {
  return (
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
            <Route path="history" element={<RunHistory />} />
            <Route path="runs/:runId" element={<RunDetails />} />
            <Route path="runs/:runId/live" element={<LiveRun />} />
            <Route path="setup" element={<Setup />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
