import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  planFindById: vi.fn(),
  runCreate: vi.fn(),
  runFindById: vi.fn(),
  runFindOneAndUpdate: vi.fn(),
  runUpdateOne: vi.fn(),
  runUpdateMany: vi.fn(),
  runLoadTest: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock('../models/test-plan.js', () => ({
  TestPlan: { findById: mocks.planFindById },
}));
vi.mock('../models/test-run.js', () => ({
  RUN_STATUS: {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
    INTERRUPTED: 'INTERRUPTED',
  },
  ACTIVE_RUN_STATUSES: ['QUEUED', 'RUNNING'],
  TestRun: {
    create: mocks.runCreate,
    findById: mocks.runFindById,
    findOneAndUpdate: mocks.runFindOneAndUpdate,
    updateOne: mocks.runUpdateOne,
    updateMany: mocks.runUpdateMany,
  },
}));
vi.mock('../services/loadEngine.js', () => ({ runLoadTest: mocks.runLoadTest }));
vi.mock('../config/logger.js', () => ({
  logger: mocks.logger,
  errorKind: (error) => error?.name ?? 'Error',
}));

const planId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const plan = {
  _id: planId,
  name: 'Plan',
  targetUrl: 'http://127.0.0.1:5050/fast',
  virtualUsers: 10,
  durationMs: 1000,
  rampUpMs: 100,
  requestTimeoutMs: 500,
  maxConnections: 10,
  requestsPerSecond: 100,
};
const metrics = {
  totalRequests: 10,
  successes: 10,
  httpErrors: 0,
  networkErrors: 0,
  timedOutRequests: 0,
  cancelled: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.planFindById.mockReturnValue({ lean: vi.fn().mockResolvedValue(plan) });
  mocks.runCreate.mockResolvedValue({ _id: runId, status: 'QUEUED' });
  mocks.runFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({ _id: runId, status: 'COMPLETED' }),
  });
  mocks.runFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
    _id: runId,
    status: update.$set.status,
  }));
  mocks.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mocks.runUpdateMany.mockResolvedValue({ modifiedCount: 2 });
  mocks.runLoadTest.mockResolvedValue(metrics);
});

async function runner() {
  return import('../services/test-runner.js');
}

describe('test runner persistence', () => {
  it('persists queued, running, snapshots and completed states', async () => {
    mocks.runLoadTest.mockImplementation(async ({ onSnapshot }) => {
      await onSnapshot({ totalRequests: 5, elapsedMs: 5_000, runtime: { peakRssMb: 50 } });
      return metrics;
    });
    const service = await runner();
    const queued = await service.startTestRun(planId, 'http://127.0.0.1:5050');
    expect(queued.status).toBe('QUEUED');

    await vi.waitFor(() =>
      expect(mocks.runFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'COMPLETED' }) }),
        expect.anything(),
      ),
    );
    expect(mocks.runUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RUNNING' }),
      expect.objectContaining({
        $push: expect.objectContaining({
          snapshots: expect.objectContaining({ $slice: -60 }),
        }),
      }),
    );
    expect(mocks.runLoadTest).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotIntervalMs: 1_000 }),
    );
  });

  it('broadcasts one-second aggregates while persisting at five-second intervals', async () => {
    mocks.runLoadTest.mockImplementation(async ({ onSnapshot }) => {
      await onSnapshot({ totalRequests: 2, elapsedMs: 1_000 });
      await onSnapshot({ totalRequests: 12, elapsedMs: 5_000 });
      return metrics;
    });
    const service = await runner();
    const updates = [];
    service.testRunEvents.on('run:update', (update) => updates.push(update));
    await service.startTestRun(planId, 'http://127.0.0.1:5050');
    await vi.waitFor(() => expect(service.hasActiveTest()).toBe(false));
    expect(mocks.runUpdateOne).toHaveBeenCalledOnce();
    expect(updates.filter((update) => update.metrics?.elapsedMs)).toHaveLength(2);
    expect(updates.map((update) => update.status)).toEqual(
      expect.arrayContaining(['QUEUED', 'RUNNING', 'COMPLETED']),
    );
  });

  it('prevents duplicate concurrent starts', async () => {
    let finish;
    mocks.runLoadTest.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const service = await runner();
    await service.startTestRun(planId, 'http://127.0.0.1:5050');
    await expect(service.startTestRun(planId, 'http://127.0.0.1:5050')).rejects.toMatchObject({
      code: 'TEST_ALREADY_ACTIVE',
    });
    finish(metrics);
    await vi.waitFor(() => expect(service.hasActiveTest()).toBe(false));
  });

  it('uses AbortSignal cancellation and persists CANCELLED', async () => {
    mocks.runLoadTest.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ ...metrics, cancelled: true }), {
            once: true,
          });
        }),
    );
    const service = await runner();
    await service.startTestRun(planId, 'http://127.0.0.1:5050');
    await vi.waitFor(() => expect(mocks.runLoadTest).toHaveBeenCalled());
    await service.cancelTestRun(runId);
    await vi.waitFor(() =>
      expect(mocks.runFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'CANCELLED' }) }),
        expect.anything(),
      ),
    );
  });

  it('persists engine failures as FAILED without exposing the error message', async () => {
    mocks.runLoadTest.mockRejectedValue(new TypeError('secret target failure'));
    const service = await runner();
    await service.startTestRun(planId, 'http://127.0.0.1:5050');
    await vi.waitFor(() =>
      expect(mocks.runFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'FAILED',
            reason: 'Execution failed (TypeError).',
          }),
        }),
        expect.anything(),
      ),
    );
  });

  it('recovers a final-result persistence failure into FAILED', async () => {
    mocks.runFindOneAndUpdate.mockImplementation(async (_filter, update) => {
      if (update.$set.status === 'COMPLETED') throw new Error('database unavailable');
      return { _id: runId, status: update.$set.status };
    });
    const service = await runner();
    await service.startTestRun(planId, 'http://127.0.0.1:5050');
    await vi.waitFor(() =>
      expect(mocks.runFindOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'FAILED' }) }),
        expect.anything(),
      ),
    );
  });

  it('marks abandoned queued and running tests interrupted on startup', async () => {
    const service = await runner();
    await expect(service.recoverInterruptedRuns()).resolves.toBe(2);
    expect(mocks.runUpdateMany).toHaveBeenCalledWith(
      { status: { $in: ['QUEUED', 'RUNNING'] } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'INTERRUPTED' }),
      }),
    );
  });

  it('propagates initial database failures without reserving the runner', async () => {
    mocks.runCreate.mockRejectedValueOnce(new Error('database unavailable'));
    const service = await runner();
    await expect(service.startTestRun(planId, 'http://127.0.0.1:5050')).rejects.toThrow(
      'database unavailable',
    );
    expect(service.hasActiveTest()).toBe(false);
  });
});
