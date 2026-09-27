// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '../components/dashboard-layout';
import { Overview } from './overview';
import { NotFound } from './not-found';
import { api, ApiError } from '../services/api';

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { health: vi.fn(), ready: vi.fn() } };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
describe('dashboard', () => {
  it('shows initial loading then real successful connection results', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockResolvedValue({ status: 'ready' });
    renderApp();
    expect(screen.getByRole('button', { name: 'Checking services…' })).toBeDisabled();
    expect(await screen.findByText('All systems ready')).toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.getByText('Test creation arrives in a future phase.')).toBeInTheDocument();
  });
  it('shows failures and lets the user retry successfully', async () => {
    api.health.mockRejectedValue(new ApiError('Cannot reach the API.'));
    api.ready.mockRejectedValue(
      new ApiError('Database unavailable.', { requestId: 'request-123' }),
    );
    renderApp();
    expect(await screen.findByText('API disconnected')).toBeInTheDocument();
    expect(screen.getByText('Request ID: request-123')).toBeInTheDocument();
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockResolvedValue({ status: 'ready' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText('All systems ready')).toBeInTheDocument();
  });
  it('distinguishes a live process from database readiness', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockRejectedValue(new ApiError('Database unavailable.'));
    renderApp();
    expect(await screen.findByText('API online · database unavailable')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('All systems ready')).toBeInTheDocument());
  });
  it('renders a not-found page for unknown routes', async () => {
    api.health.mockResolvedValue({ status: 'ok' });
    api.ready.mockResolvedValue({ status: 'ready' });
    renderApp('/does-not-exist');
    expect(
      screen.getByRole('heading', { name: 'A little off the test path.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/');
    await screen.findByText('All systems ready');
  });
});
