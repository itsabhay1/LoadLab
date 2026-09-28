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
  run: { exists: vi.fn(), find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn() },
  target: { findOne: vi.fn(), countDocuments: vi.fn() },
  startTestRun: vi.fn(),
  cancelTestRun: vi.fn(),
}));

const ownerA = '507f1f77bcf86cd799439010';
const ownerB = '507f1f77bcf86cd799439020';

vi.mock('../middleware/auth.js', () => ({
  authenticate(req, res, next) {
    if (req.get('x-test-unauthenticated') === 'true') {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED' } });
    }
    const userId = req.get('x-test-user') ?? ownerA;
    req.auth = { userId, user: { _id: userId, name: 'Test User', email: 'test@example.com' } };
    return next();
  },
  createAccessToken: vi.fn(() => 'token'),
}));
vi.mock('../models/test-plan.js', () => ({ TestPlan: mocks.plan }));
vi.mock('../models/target.js', () => ({
  TARGET_STATUS: { PENDING: 'PENDING', VERIFIED: 'VERIFIED' },
  Target: mocks.target,
}));
vi.mock('../models/test-run.js', () => ({
  ACTIVE_RUN_STATUSES: ['QUEUED', 'RUNNING'],
  RUN_STATUS: {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
    INTERRUPTED: 'INTERRUPTED',
  },
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
const targetId = '507f1f77bcf86cd799439013';
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
  const query = {
    sort: vi.fn(() => query),
    skip: vi.fn(() => query),
    limit: vi.fn(() => query),
    select: vi.fn(() => query),
    lean: vi.fn().mockResolvedValue(value),
  };
  return query;
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
  mocks.run.countDocuments.mockResolvedValue(0);
  mocks.run.findOne.mockReturnValue(lean({ _id: runId, owner: ownerA, status: 'COMPLETED' }));
  mocks.target.findOne.mockReturnValue(
    lean({
      _id: targetId,
      owner: ownerA,
      baseUrl: 'https://api.example.com',
      status: 'VERIFIED',
    }),
  );
  mocks.startTestRun.mockResolvedValue({ _id: runId, status: 'QUEUED' });
  mocks.cancelTestRun.mockResolvedValue();
});

describe('test management API', () => {
  it('creates, lists, updates and deletes only owner-scoped plans', async () => {
    const app = createApp(config);
    expect((await request(app).post('/api/v1/plans').send(input)).status).toBe(201);
    expect(mocks.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({ ...input, owner: ownerA, targetMode: 'LOCAL', method: 'GET' }),
    );
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

  it('keeps local mock plans disabled in production', async () => {
    const response = await request(createApp({ ...config, NODE_ENV: 'production' }))
      .post('/api/v1/plans')
      .send(input);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('LOCAL_TARGET_DISABLED');
    expect(mocks.plan.create).not.toHaveBeenCalled();
  });

  it('starts and cancels execution asynchronously with the authenticated owner', async () => {
    const app = createApp(config);
    const started = await request(app).post(`/api/v1/plans/${planId}/runs`);
    expect(started.status).toBe(202);
    expect(mocks.startTestRun).toHaveBeenCalledWith(
      planId,
      ownerA,
      config.MOCK_SERVER_URL,
      config.NODE_ENV,
    );
    const cancelled = await request(app).post(`/api/v1/runs/${runId}/cancel`);
    expect(cancelled.status).toBe(202);
    expect(mocks.cancelTestRun).toHaveBeenCalledWith(runId, ownerA);
  });

  it('starts a production external run and cancels it without a loopback-source requirement', async () => {
    const productionConfig = { ...config, NODE_ENV: 'production' };
    const app = createApp(productionConfig);
    const started = await request(app)
      .post(`/api/v1/plans/${planId}/runs`)
      .set('X-Forwarded-For', '203.0.113.10');
    expect(started.status).toBe(202);
    expect(mocks.startTestRun).toHaveBeenCalledWith(
      planId,
      ownerA,
      config.MOCK_SERVER_URL,
      'production',
    );

    const cancelled = await request(app)
      .post(`/api/v1/runs/${runId}/cancel`)
      .set('X-Forwarded-For', '203.0.113.10');
    expect(cancelled.status).toBe(202);
    expect(mocks.cancelTestRun).toHaveBeenCalledWith(runId, ownerA);
  });

  it('rejects an unauthenticated run start', async () => {
    const response = await request(createApp({ ...config, NODE_ENV: 'production' }))
      .post(`/api/v1/plans/${planId}/runs`)
      .set('x-test-unauthenticated', 'true');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
    expect(mocks.startTestRun).not.toHaveBeenCalled();
  });

  it('creates a plan only from an owned verified external target', async () => {
    const external = {
      ...input,
      targetMode: 'EXTERNAL',
      targetUrl: undefined,
      targetId,
      endpointPath: '/api/products?q=loadlab',
      method: 'POST',
      requestHeaders: { Authorization: 'Bearer example' },
      requestBody: { sample: true },
    };
    const response = await request(createApp(config)).post('/api/v1/plans').send(external);
    expect(response.status).toBe(201);
    expect(mocks.target.findOne).toHaveBeenCalledWith({
      _id: targetId,
      owner: ownerA,
      status: 'VERIFIED',
    });
    expect(mocks.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: ownerA,
        target: targetId,
        targetMode: 'EXTERNAL',
        targetUrl: 'https://api.example.com/api/products?q=loadlab',
        method: 'POST',
        requestHeaders: { authorization: 'Bearer example', 'content-type': 'application/json' },
      }),
    );
  });

  it('cannot use another user or unverified target in a plan', async () => {
    mocks.target.findOne.mockReturnValue(lean(null));
    const response = await request(createApp(config))
      .post('/api/v1/plans')
      .set('x-test-user', ownerB)
      .send({
        ...input,
        targetMode: 'EXTERNAL',
        targetUrl: undefined,
        targetId,
        endpointPath: '/api/products',
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TARGET_NOT_VERIFIED');
    expect(mocks.plan.create).not.toHaveBeenCalled();
  });

  it('rejects hostname-overriding paths and forbidden headers', async () => {
    const base = {
      ...input,
      targetMode: 'EXTERNAL',
      targetUrl: undefined,
      targetId,
      endpointPath: '/api/products',
    };
    const pathResponse = await request(createApp(config))
      .post('/api/v1/plans')
      .send({ ...base, endpointPath: '//evil.example/path' });
    expect(pathResponse.status).toBe(400);
    expect(pathResponse.body.error.code).toBe('INVALID_ENDPOINT_PATH');
    const headerResponse = await request(createApp(config))
      .post('/api/v1/plans')
      .send({ ...base, requestHeaders: { Host: '127.0.0.1' } });
    expect(headerResponse.status).toBe(400);
    expect(headerResponse.body.error.code).toBe('INVALID_HEADERS');
  });

  it('returns only owner-scoped run status and history', async () => {
    const app = createApp(config);
    expect((await request(app).get(`/api/v1/runs/${runId}`)).body.run.status).toBe('COMPLETED');
    expect((await request(app).get(`/api/v1/runs?planId=${planId}`)).body.runs).toEqual([]);
    expect(mocks.run.findOne).toHaveBeenCalledWith({ _id: runId, owner: ownerA });
    expect(mocks.run.find).toHaveBeenCalledWith({ owner: ownerA, plan: planId });
  });

  it('filters, sorts and paginates owner-scoped run history', async () => {
    mocks.run.countDocuments.mockResolvedValue(41);
    const response = await request(createApp(config)).get(
      '/api/v1/runs?status=COMPLETED&sort=oldest&page=2&limit=20',
    );
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 2, limit: 20, total: 41, pages: 3 });
    expect(mocks.run.find).toHaveBeenCalledWith({ owner: ownerA, status: 'COMPLETED' });
    const historyQuery = mocks.run.find.mock.results.at(-1).value;
    expect(historyQuery.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    expect(historyQuery.skip).toHaveBeenCalledWith(20);
    expect(historyQuery.limit).toHaveBeenCalledWith(20);
  });

  it('filters history through plans attached to an owned target', async () => {
    const response = await request(createApp(config)).get(`/api/v1/runs?targetId=${targetId}`);
    expect(response.status).toBe(200);
    expect(mocks.plan.find).toHaveBeenCalledWith({ owner: ownerA, target: targetId });
    expect(mocks.run.find).toHaveBeenCalledWith({ owner: ownerA, plan: { $in: [planId] } });
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

  it('rejects a run start for another user or an unowned plan', async () => {
    mocks.startTestRun.mockRejectedValue(
      Object.assign(new Error('not found'), {
        status: 404,
        code: 'PLAN_NOT_FOUND',
        publicMessage: 'Test plan was not found.',
      }),
    );
    const response = await request(createApp({ ...config, NODE_ENV: 'production' }))
      .post(`/api/v1/plans/${planId}/runs`)
      .set('x-test-user', ownerB);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PLAN_NOT_FOUND');
    expect(mocks.startTestRun).toHaveBeenCalledWith(
      planId,
      ownerB,
      config.MOCK_SERVER_URL,
      'production',
    );
  });

  it('sanitizes database failures', async () => {
    mocks.plan.create.mockRejectedValue(new Error('mongodb://user:secret@host/db'));
    const response = await request(createApp(config)).post('/api/v1/plans').send(input);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
