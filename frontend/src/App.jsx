import { Route, Routes } from 'react-router-dom';
import { DashboardLayout } from './components/dashboard-layout';
import { NotFound } from './pages/not-found';
import { Overview } from './pages/overview';
import { Setup } from './pages/setup';

export function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<Overview />} />
        <Route path="setup" element={<Setup />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
