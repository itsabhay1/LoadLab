import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  plan: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
  },
  run: { exists: vi.fn(), find: vi.fn(), findOne: vi.fn() },
  startTestRun: vi.fn(),
  cancelTestRun: vi.fn(),
}));

const ownerA = '507f1f77bcf86cd799439010';
const ownerB = '507f1f77bcf86cd799439020';

vi.mock('../middleware/auth.js', () => ({
  authenticate(req, _res, next) {
    const userId = req.get('x-test-user') ?? ownerA;
    req.auth = { userId, user: { _id: userId, name: 'Test User', email: 'test@example.com' } };
    next();
  },
  createAccessToken: vi.fn(() => 'token'),
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
  GOOGLE_CLIENT_ID: '',
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
const ownedPlan = { _id: planId, owner: ownerA, ...input };

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
  mocks.plan.create.mockResolvedValue(ownedPlan);
  mocks.plan.find.mockReturnValue(list([ownedPlan]));
  mocks.plan.findOne.mockReturnValue(lean(ownedPlan));
  mocks.plan.findOneAndUpdate.mockResolvedValue(ownedPlan);
  mocks.plan.findOneAndDelete.mockResolvedValue({ _id: planId });
  mocks.run.exists.mockResolvedValue(false);
  mocks.run.find.mockReturnValue(list([]));
  mocks.run.findOne.mockReturnValue(lean({ _id: runId, owner: ownerA, status: 'COMPLETED' }));
  mocks.startTestRun.mockResolvedValue({ _id: runId, status: 'QUEUED' });
  mocks.cancelTestRun.mockResolvedValue();
});

describe('test management API', () => {
  it('creates, lists, updates and deletes only owner-scoped plans', async () => {
    const app = createApp(config);
    expect((await request(app).post('/api/v1/plans').send(input)).status).toBe(201);
    expect(mocks.plan.create).toHaveBeenCalledWith({ ...input, owner: ownerA });
    expect((await request(app).get('/api/v1/plans')).body.plans).toHaveLength(1);
    expect(mocks.plan.find).toHaveBeenCalledWith({ owner: ownerA });
    const updated = await request(app)
      .patch(`/api/v1/plans/${planId}`)
      .send({ name: 'Updated plan' });
    expect(updated.status).toBe(200);
    expect(mocks.plan.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: planId, owner: ownerA },
      expect.objectContaining({ name: 'Updated plan' }),
      expect.objectContaining({ runValidators: true }),
    );
    expect((await request(app).delete(`/api/v1/plans/${planId}`)).status).toBe(204);
    expect(mocks.plan.findOneAndDelete).toHaveBeenCalledWith({ _id: planId, owner: ownerA });
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

  it('starts and cancels execution asynchronously with the authenticated owner', async () => {
    const app = createApp(config);
    const started = await request(app).post(`/api/v1/plans/${planId}/runs`);
    expect(started.status).toBe(202);
    expect(mocks.startTestRun).toHaveBeenCalledWith(planId, ownerA, config.MOCK_SERVER_URL);
    const cancelled = await request(app).post(`/api/v1/runs/${runId}/cancel`);
    expect(cancelled.status).toBe(202);
    expect(mocks.cancelTestRun).toHaveBeenCalledWith(runId, ownerA);
  });

  it('returns only owner-scoped run status and history', async () => {
    const app = createApp(config);
    expect((await request(app).get(`/api/v1/runs/${runId}`)).body.run.status).toBe('COMPLETED');
    expect((await request(app).get(`/api/v1/runs?planId=${planId}`)).body.runs).toEqual([]);
    expect(mocks.run.findOne).toHaveBeenCalledWith({ _id: runId, owner: ownerA });
    expect(mocks.run.find).toHaveBeenCalledWith({ owner: ownerA, plan: planId });
  });

  it('prevents deleting an owned plan with an active run', async () => {
    mocks.run.exists.mockResolvedValue(true);
    const response = await request(createApp(config)).delete(`/api/v1/plans/${planId}`);
    expect(response.status).toBe(409);
    expect(mocks.run.exists).toHaveBeenCalledWith({
      plan: planId,
      owner: ownerA,
      status: { $in: ['QUEUED', 'RUNNING'] },
    });
  });

  it('keeps another user and unowned plans inaccessible for reads and updates', async () => {
    mocks.plan.findOne.mockReturnValue(lean(null));
    const app = createApp(config);
    expect((await request(app).get(`/api/v1/plans/${planId}`)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/v1/plans/${planId}`).send({ name: 'Stolen' })).status,
    ).toBe(404);
    expect(mocks.plan.findOne).toHaveBeenCalledWith({ _id: planId, owner: ownerA });
    expect(mocks.plan.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not expose another user or unowned run and cannot cancel it', async () => {
    mocks.run.findOne.mockReturnValue(lean(null));
    mocks.cancelTestRun.mockRejectedValue(
      Object.assign(new Error('not found'), {
        status: 404,
        code: 'RUN_NOT_FOUND',
        publicMessage: 'Test run was not found.',
      }),
    );
    const app = createApp(config);
    expect((await request(app).get(`/api/v1/runs/${runId}`)).status).toBe(404);
    expect((await request(app).post(`/api/v1/runs/${runId}/cancel`)).status).toBe(404);
    expect(mocks.cancelTestRun).toHaveBeenCalledWith(runId, ownerA);
  });

  it('passes the requester identity when starting a plan owned by another user ID', async () => {
    await request(createApp(config))
      .post(`/api/v1/plans/${planId}/runs`)
      .set('x-test-user', ownerB);
    expect(mocks.startTestRun).toHaveBeenCalledWith(planId, ownerB, config.MOCK_SERVER_URL);
  });

  it('sanitizes database failures', async () => {
    mocks.plan.create.mockRejectedValue(new Error('mongodb://user:secret@host/db'));
    const response = await request(createApp(config)).post('/api/v1/plans').send(input);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
