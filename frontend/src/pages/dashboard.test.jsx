// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '../components/dashboard-layout';
import { Overview } from './overview';
import { NotFound } from './not-found';
import { api, ApiError } from '../services/api';
import { ThemeProvider } from '../hooks/use-theme';

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    api: { health: vi.fn(), ready: vi.fn(), overview: vi.fn() },
  };
});
vi.mock('../context/auth-context', () => ({
  useAuth: () => ({ user: { name: 'Test User', email: 'test@example.com' }, logout: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
function renderApp(path = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route index element={<Overview />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}
describe('dashboard', () => {
  beforeEach(() => {
    api.overview.mockResolvedValue({
      overview: {
        totals: { completedRuns: 0, failedRuns: 0, cancelledRuns: 0, verifiedTargets: 0 },
        recentRuns: [],
        latestPerformance: null,
        recentPlans: [],
      },
    });
  });
  it('shows initial loading then real successful connection results', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockResolvedValue({ status: 'ready' });
    renderApp();
    expect(screen.getByText('Checking system')).toBeInTheDocument();
    expect(await screen.findByText('System operational')).toBeInTheDocument();
    expect(screen.queryByText('Service connections')).not.toBeInTheDocument();
    expect(screen.queryByText('/api/v1/health')).not.toBeInTheDocument();
    expect(screen.queryByText('/api/v1/ready')).not.toBeInTheDocument();
    expect(screen.getByText('Load test verified APIs with confidence.')).toBeInTheDocument();
    expect(screen.queryByText(/Phase/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Setup guide')).not.toBeInTheDocument();
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });
  it('shows service failures in the compact status indicator', async () => {
    api.health.mockRejectedValue(new ApiError('Cannot reach the API.'));
    api.ready.mockRejectedValue(
      new ApiError('Database unavailable.', { requestId: 'request-123' }),
    );
    renderApp();
    expect(await screen.findByText('Service issue')).toBeInTheDocument();
    expect(screen.getByLabelText(/API: Unavailable/)).toHaveAttribute(
      'title',
      'API: Unavailable · Database: Unavailable',
    );
  });
  it('distinguishes a live process from database readiness', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockRejectedValue(new ApiError('Database unavailable.'));
    renderApp();
    expect(await screen.findByText('Service issue')).toBeInTheDocument();
  });
  it('supports an accessible persistent theme toggle and mobile navigation', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockResolvedValue({ status: 'ready' });
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('loadlab-theme')).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await waitFor(() => expect(screen.getByText('System operational')).toBeInTheDocument());
  });
  it('renders a not-found page for unknown routes', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockResolvedValue({ status: 'ready' });
    renderApp('/does-not-exist');
    expect(
      screen.getByRole('heading', { name: 'A little off the test path.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/');
    await screen.findByText('System operational');
  });
});
