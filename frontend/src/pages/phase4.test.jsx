// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TestPlans } from './test-plans';
import { RunHistory } from './run-history';
import { LiveRun } from './live-run';
import { RunDetails } from './run-details';
import { ApiError, api } from '../services/api';
import { createRunSocket } from '../services/socket';

vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    api: {
      listPlans: vi.fn(),
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
      deletePlan: vi.fn(),
      startRun: vi.fn(),
      listRuns: vi.fn(),
      getRun: vi.fn(),
      cancelRun: vi.fn(),
    },
  };
});
vi.mock('../services/socket', () => ({ createRunSocket: vi.fn() }));

const plan = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Fast smoke test',
  targetUrl: 'http://127.0.0.1:5050/fast',
  virtualUsers: 10,
  durationMs: 10000,
  rampUpMs: 2000,
  requestTimeoutMs: 3000,
  maxConnections: 10,
  requestsPerSecond: 100,
};
const run = {
  _id: '507f1f77bcf86cd799439012',
  plan: plan._id,
  status: 'RUNNING',
  configurationSnapshot: plan,
  queuedAt: '2026-09-27T10:00:00.000Z',
  startedAt: '2026-09-27T10:00:01.000Z',
  snapshots: [],
};

function renderPage(path, routePath, element, extraRoutes) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        {extraRoutes}
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  api.listPlans.mockResolvedValue({ plans: [] });
  api.listRuns.mockResolvedValue({ runs: [] });
  window.confirm = vi.fn(() => true);
});

describe('Phase 4 dashboard actions', () => {
  it('creates and starts a test plan', async () => {
    api.createPlan.mockResolvedValue({ plan });
    api.startRun.mockResolvedValue({ runId: run._id, status: 'QUEUED' });
    renderPage(
      '/plans',
      '/plans',
      <TestPlans />,
      <Route path="/runs/:runId/live" element={<div>Live route opened</div>} />,
    );
    await screen.findByText('No test plans yet');
    await userEvent.click(screen.getByRole('button', { name: 'New plan' }));
    await userEvent.type(screen.getByLabelText('Plan name'), plan.name);
    await userEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(await screen.findByText(plan.name)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start test' }));
    expect(await screen.findByText('Live route opened')).toBeInTheDocument();
  });

  it('deletes a test plan after confirmation', async () => {
    api.listPlans.mockResolvedValue({ plans: [plan] });
    api.deletePlan.mockResolvedValue();
    renderPage('/plans', '/plans', <TestPlans />);
    expect(await screen.findByText(plan.name)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `Delete ${plan.name}` }));
    await waitFor(() => expect(screen.queryByText(plan.name)).not.toBeInTheDocument());
    expect(api.deletePlan).toHaveBeenCalledWith(plan._id);
  });

  it('shows run history and its API error state', async () => {
    api.listRuns.mockResolvedValueOnce({
      runs: [
        {
          ...run,
          status: 'COMPLETED',
          finalMetrics: {
            totalRequests: 20,
            successes: 20,
            httpErrors: 0,
            networkErrors: 0,
            rps: 10,
            p95LatencyMs: 4,
          },
        },
      ],
    });
    const view = renderPage('/history', '/history', <RunHistory />);
    expect(await screen.findByText('Fast smoke test')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    view.unmount();
    api.listRuns.mockRejectedValueOnce(new ApiError('Cannot reach the API.'));
    renderPage('/history', '/history', <RunHistory />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the API.');
  });

  it('applies live metrics, cancels, and resynchronizes after reconnect', async () => {
    const handlers = new Map();
    const socket = {
      on: vi.fn((event, handler) => {
        handlers.set(event, handler);
        return socket;
      }),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(() => queueMicrotask(() => handlers.get('connect')?.())),
    };
    createRunSocket.mockReturnValue(socket);
    api.getRun.mockResolvedValue({ run });
    api.cancelRun.mockResolvedValue({ runId: run._id, cancellationRequested: true });
    renderPage(`/runs/${run._id}/live`, '/runs/:runId/live', <LiveRun />);
    expect(await screen.findByText('Fast smoke test')).toBeInTheDocument();
    handlers.get('run:update')({
      runId: run._id,
      status: 'RUNNING',
      metrics: {
        totalRequests: 42,
        successes: 40,
        httpErrors: 2,
        networkErrors: 0,
        rps: 21,
        p50LatencyMs: 3,
        p95LatencyMs: 7,
        activeVirtualUsers: 10,
        elapsedMs: 5000,
      },
    });
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel test' }));
    expect(api.cancelRun).toHaveBeenCalledWith(run._id);
    handlers.get('disconnect')();
    handlers.get('connect')();
    await waitFor(() => expect(api.getRun.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(socket.emit).toHaveBeenCalledWith('run:subscribe', run._id);
  });

  it('labels the completed-run user count as the peak virtual users', async () => {
    api.getRun.mockResolvedValue({
      run: {
        ...run,
        status: 'COMPLETED',
        finishedAt: '2026-09-27T10:00:11.000Z',
        finalMetrics: {
          totalRequests: 100,
          successes: 100,
          httpErrors: 0,
          networkErrors: 0,
          rps: 10,
          p50LatencyMs: 2,
          p95LatencyMs: 5,
          activeVirtualUsers: 10,
          elapsedMs: 10000,
        },
      },
    });
    renderPage(`/runs/${run._id}`, '/runs/:runId', <RunDetails />);
    const label = await screen.findByText('Peak virtual users');
    expect(label.parentElement).toHaveTextContent('10');
    expect(screen.queryByText('Active users')).not.toBeInTheDocument();
  });
});
