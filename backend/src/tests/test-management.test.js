import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  plan: {
    create: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
  },
  run: {
    exists: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
  },
  startTestRun: vi.fn(),
  cancelTestRun: vi.fn(),
}));

vi.mock('../models/test-plan.js', () => ({ TestPlan: mocks.plan }));
vi.mock('../models/test-run.js', () => ({
  ACTIVE_RUN_STATUSES: ['QUEUED', 'RUNNING'],
  TestRun: mocks.run,
}));
vi.mock('../services/test-runner.js', () => ({
  startTestRun: mocks.startTestRun,
  cancelTestRun: mocks.cancelTestRun,
}));
vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  errorKind: (error) => error?.name ?? 'Error',
}));

const { createApp } = await import('../app.js');
const config = {
  NODE_ENV: 'test',
  CLIENT_URL: 'http://localhost:5173',
  MOCK_SERVER_URL: 'http://127.0.0.1:5050',
};
const planId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const input = {
  name: 'Fast endpoint',
  targetUrl: 'http://127.0.0.1:5050/fast',
  virtualUsers: 100,
  durationMs: 60_000,
  rampUpMs: 15_000,
  requestTimeoutMs: 5_000,
  maxConnections: 100,
  requestsPerSecond: 1_000,
};

function lean(value) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function list(value) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plan.create.mockResolvedValue({ _id: planId, ...input });
  mocks.plan.find.mockReturnValue(list([{ _id: planId, ...input }]));
  mocks.plan.findById.mockReturnValue(lean({ _id: planId, ...input }));
  mocks.plan.findByIdAndUpdate.mockResolvedValue({ _id: planId, ...input });
  mocks.plan.findByIdAndDelete.mockResolvedValue({ _id: planId });
  mocks.run.exists.mockResolvedValue(false);
  mocks.run.find.mockReturnValue(list([]));
  mocks.run.findById.mockReturnValue(lean({ _id: runId, status: 'COMPLETED' }));
  mocks.startTestRun.mockResolvedValue({ _id: runId, status: 'QUEUED' });
  mocks.cancelTestRun.mockResolvedValue();
});

describe('test management API', () => {
  it('creates, lists, updates and deletes plans', async () => {
    const app = createApp(config);
    expect((await request(app).post('/api/v1/plans').send(input)).status).toBe(201);
    expect((await request(app).get('/api/v1/plans')).body.plans).toHaveLength(1);
    const updated = await request(app)
      .patch(`/api/v1/plans/${planId}`)
      .send({ name: 'Updated plan' });
    expect(updated.status).toBe(200);
    expect(mocks.plan.findByIdAndUpdate).toHaveBeenCalledWith(
      planId,
      expect.objectContaining({ name: 'Updated plan' }),
      expect.objectContaining({ runValidators: true }),
    );
    expect((await request(app).delete(`/api/v1/plans/${planId}`)).status).toBe(204);
  });

  it.each([
    { ...input, virtualUsers: 1001 },
    { ...input, rampUpMs: input.durationMs },
    { ...input, maxConnections: 101 },
    { ...input, targetUrl: 'https://example.com/fast' },
    { ...input, unexpected: true },
  ])('rejects invalid plan configuration', async (body) => {
    const response = await request(createApp(config)).post('/api/v1/plans').send(body);
    expect(response.status).toBe(400);
    expect(mocks.plan.create).not.toHaveBeenCalled();
  });

  it('starts and cancels execution asynchronously', async () => {
    const app = createApp(config);
    const started = await request(app).post(`/api/v1/plans/${planId}/runs`);
    expect(started.status).toBe(202);
    expect(started.body).toEqual({ runId, status: 'QUEUED' });
    expect(mocks.startTestRun).toHaveBeenCalledWith(planId, config.MOCK_SERVER_URL);

    const cancelled = await request(app).post(`/api/v1/runs/${runId}/cancel`);
    expect(cancelled.status).toBe(202);
    expect(mocks.cancelTestRun).toHaveBeenCalledWith(runId);
  });

  it('returns run status and bounded history', async () => {
    const app = createApp(config);
    expect((await request(app).get(`/api/v1/runs/${runId}`)).body.run.status).toBe('COMPLETED');
    expect((await request(app).get(`/api/v1/runs?planId=${planId}`)).body.runs).toEqual([]);
    expect(mocks.run.find).toHaveBeenCalledWith({ plan: planId });
  });

  it('prevents deleting a plan with an active run', async () => {
    mocks.run.exists.mockResolvedValue(true);
    const response = await request(createApp(config)).delete(`/api/v1/plans/${planId}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PLAN_ACTIVE');
  });

  it('sanitizes database failures', async () => {
    mocks.plan.create.mockRejectedValue(new Error('mongodb://user:secret@host/db'));
    const response = await request(createApp(config)).post('/api/v1/plans').send(input);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
