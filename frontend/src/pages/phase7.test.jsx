// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RunComparison } from './run-comparison';
import { RunDetails } from './run-details';
import { RunHistory } from './run-history';
import { ApiError, api } from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    listRuns: vi.fn(),
    listPlans: vi.fn(),
    listTargets: vi.fn(),
    compareRuns: vi.fn(),
    getRun: vi.fn(),
    exportRun: vi.fn(),
  },
}));

const configuration = {
  name: 'Checkout baseline',
  targetUrl: 'https://api.example.com/checkout',
  method: 'POST',
  virtualUsers: 10,
  durationMs: 10_000,
  rampUpMs: 1_000,
  maxConnections: 10,
  requestsPerSecond: 100,
  requestTimeoutMs: 3_000,
};
const completedRuns = [
  {
    _id: 'run-a',
    plan: 'plan-a',
    status: 'COMPLETED',
    configurationSnapshot: configuration,
    queuedAt: '2026-09-28T10:00:00.000Z',
    startedAt: '2026-09-28T10:00:00.000Z',
    finishedAt: '2026-09-28T10:00:10.000Z',
    snapshots: [],
    finalMetrics: {
      totalRequests: 100,
      successes: 100,
      httpErrors: 0,
      networkErrors: 0,
      rps: 10,
      p50LatencyMs: 4,
      p95LatencyMs: 8,
      activeVirtualUsers: 10,
    },
  },
  {
    _id: 'run-b',
    plan: 'plan-b',
    status: 'COMPLETED',
    configurationSnapshot: { ...configuration, name: 'Checkout candidate' },
    queuedAt: '2026-09-28T11:00:00.000Z',
    startedAt: '2026-09-28T11:00:00.000Z',
    finishedAt: '2026-09-28T11:00:10.000Z',
    snapshots: [],
    finalMetrics: {
      totalRequests: 120,
      successes: 118,
      httpErrors: 2,
      networkErrors: 0,
      rps: 12,
      p50LatencyMs: 5,
      p95LatencyMs: 9,
      activeVirtualUsers: 10,
    },
  },
];

function renderPage(path, route, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  api.listRuns.mockResolvedValue({
    runs: completedRuns,
    pagination: { page: 1, limit: 20, total: 2, pages: 1 },
  });
  api.listPlans.mockResolvedValue({ plans: [{ _id: 'plan-a', name: 'Checkout baseline' }] });
  api.listTargets.mockResolvedValue({ targets: [{ _id: 'target-a', name: 'Owned API' }] });
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe('analysis UI', () => {
  it('selects completed runs and renders comparison facts', async () => {
    api.compareRuns.mockResolvedValue({
      comparison: {
        runA: {
          id: 'run-a',
          name: 'Checkout baseline',
          status: 'COMPLETED',
          configuration: {
            target: configuration.targetUrl,
            method: 'POST',
            endpoint: '/checkout',
            virtualUsers: 10,
            durationMs: 10_000,
            rampUpMs: 1_000,
            maxConnections: 10,
            requestsPerSecond: 100,
            requestTimeoutMs: 3_000,
          },
          metrics: {
            completedRequests: 100,
            successfulRequests: 100,
            httpErrors: 0,
            networkErrors: 0,
            timeouts: 0,
            rps: 10,
            p50LatencyMs: 4,
            p95LatencyMs: 8,
            errorRatePercent: 0,
            cpuUtilizationPercent: 12,
            peakRssMb: 90,
            peakHeapUsedMb: 40,
            eventLoopDelayMeanMs: 1,
            eventLoopDelayP95Ms: 2,
            eventLoopDelayMaxMs: 3,
          },
          snapshots: [],
          finalMetrics: completedRuns[0].finalMetrics,
        },
        runB: {
          id: 'run-b',
          name: 'Checkout candidate',
          status: 'COMPLETED',
          configuration: {
            target: configuration.targetUrl,
            method: 'POST',
            endpoint: '/checkout',
            virtualUsers: 10,
            durationMs: 10_000,
            rampUpMs: 1_000,
            maxConnections: 10,
            requestsPerSecond: 100,
            requestTimeoutMs: 3_000,
          },
          metrics: {
            completedRequests: 120,
            successfulRequests: 118,
            httpErrors: 2,
            networkErrors: 0,
            timeouts: 0,
            rps: 12,
            p50LatencyMs: 5,
            p95LatencyMs: 9,
            errorRatePercent: 1.67,
            cpuUtilizationPercent: 14,
            peakRssMb: 95,
            peakHeapUsedMb: 43,
            eventLoopDelayMeanMs: 1.2,
            eventLoopDelayP95Ms: 2.4,
            eventLoopDelayMaxMs: 3.6,
          },
          snapshots: [],
          finalMetrics: completedRuns[1].finalMetrics,
        },
        deltas: {
          rpsDifference: 2,
          rpsPercentageChange: 20,
          p50DifferenceMs: 1,
          p95DifferenceMs: 1,
          errorRateDifferencePoints: 1.67,
        },
      },
    });
    renderPage('/compare', '/compare', <RunComparison />);
    expect(await screen.findAllByRole('option', { name: /Checkout candidate/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(await screen.findByText('RPS percentage change')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('Target/API Performance')).toBeInTheDocument();
    expect(screen.getByText('Load Generator Health')).toBeInTheDocument();
    expect(screen.getByText('Load Generator CPU (%)')).toBeInTheDocument();
    expect(screen.getByText('Load Generator Event Loop Max (ms)')).toBeInTheDocument();
    expect(screen.queryByText('CPU utilization (%)')).not.toBeInTheDocument();
    expect(api.compareRuns).toHaveBeenCalledWith('run-a', 'run-b');
  });

  it('shows comparison loading and error states', async () => {
    api.listRuns.mockRejectedValueOnce(new ApiError('Comparison history unavailable.'));
    renderPage('/compare', '/compare', <RunComparison />);
    expect(screen.getByText('Loading completed runs')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Comparison history unavailable.');
  });

  it('exports completed reports from the run details page', async () => {
    api.getRun.mockResolvedValue({ run: completedRuns[0] });
    api.exportRun.mockResolvedValue({
      blob: new Blob(['report']),
      filename: 'loadlab-run-2026-09-28.json',
    });
    renderPage('/runs/run-a', '/runs/:runId', <RunDetails />);
    expect(await screen.findAllByText('Checkout baseline')).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: /JSON/ }));
    expect(api.exportRun).toHaveBeenCalledWith('run-a', 'json');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('applies history filters and pagination parameters', async () => {
    renderPage('/history', '/history', <RunHistory />);
    expect(await screen.findAllByText('Checkout baseline')).not.toHaveLength(0);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'COMPLETED');
    await waitFor(() =>
      expect(api.listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'COMPLETED', page: 1, limit: 20 }),
      ),
    );
  });
});
