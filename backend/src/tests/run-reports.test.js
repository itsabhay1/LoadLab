import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: { find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn() },
  target: { countDocuments: vi.fn() },
}));

const ownerA = '507f1f77bcf86cd799439010';
const ownerB = '507f1f77bcf86cd799439020';
const runAId = '507f1f77bcf86cd799439011';
const runBId = '507f1f77bcf86cd799439012';
const planId = '507f1f77bcf86cd799439013';

vi.mock('../middleware/auth.js', () => ({
  authenticate(req, _res, next) {
    const userId = req.get('x-test-user') ?? ownerA;
    req.auth = { userId, user: { _id: userId } };
    next();
  },
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
vi.mock('../models/target.js', () => ({
  TARGET_STATUS: { PENDING: 'PENDING', VERIFIED: 'VERIFIED' },
  Target: {
    ...mocks.target,
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    findOneAndDelete: vi.fn(),
  },
}));
vi.mock('../models/test-plan.js', () => ({
  TestPlan: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
  },
}));
vi.mock('../services/test-runner.js', () => ({ startTestRun: vi.fn(), cancelTestRun: vi.fn() }));
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

function query(value) {
  const chain = {
    sort: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    lean: vi.fn().mockResolvedValue(value),
  };
  return chain;
}

function completedRun(id, overrides = {}) {
  return {
    _id: id,
    owner: ownerA,
    plan: planId,
    status: 'COMPLETED',
    queuedAt: '2026-09-28T09:59:59.000Z',
    startedAt: '2026-09-28T10:00:00.000Z',
    finishedAt: '2026-09-28T10:00:10.000Z',
    createdAt: '2026-09-28T09:59:59.000Z',
    configurationSnapshot: {
      name: 'Plan, "quoted"',
      targetUrl: 'https://api.example.com/items',
      targetMode: 'EXTERNAL',
      method: 'GET',
      virtualUsers: 10,
      durationMs: 10_000,
      rampUpMs: 1_000,
      maxConnections: 10,
      requestsPerSecond: 100,
      requestTimeoutMs: 3_000,
      requestHeaders: { Authorization: 'Bearer private-jwt', Accept: 'application/json' },
      requestBody: { password: 'private-password', query: 'safe' },
    },
    finalMetrics: {
      totalRequests: 100,
      successes: 95,
      httpErrors: 3,
      networkErrors: 2,
      timedOutRequests: 1,
      rps: 10,
      averageLatencyMs: 5,
      minLatencyMs: 1,
      maxLatencyMs: 20,
      p50LatencyMs: 4,
      p95LatencyMs: 12,
      activeVirtualUsers: 10,
      elapsedMs: 10_000,
      runtime: { cpuUtilizationPercent: 20, peakRssMb: 100, eventLoopDelayP95Ms: 2 },
    },
    snapshots: [
      {
        capturedAt: '2026-09-28T10:00:05.000Z',
        metrics: { elapsedMs: 5_000, rps: 8, p95LatencyMs: 10 },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.find.mockReturnValue(query([]));
  mocks.run.findOne.mockReturnValue(query(null));
  mocks.run.countDocuments.mockResolvedValue(0);
  mocks.target.countDocuments.mockResolvedValue(0);
});

describe('run comparison', () => {
  it('compares two completed owned runs and calculates factual deltas', async () => {
    const runA = completedRun(runAId);
    const runB = completedRun(runBId, {
      finalMetrics: {
        ...runA.finalMetrics,
        totalRequests: 200,
        httpErrors: 10,
        networkErrors: 0,
        rps: 15,
        p50LatencyMs: 6,
        p95LatencyMs: 18,
      },
    });
    mocks.run.find.mockReturnValue(query([runB, runA]));
    const response = await request(createApp(config)).get(
      `/api/v1/runs/compare?runA=${runAId}&runB=${runBId}`,
    );
    expect(response.status).toBe(200);
    expect(mocks.run.find).toHaveBeenCalledWith({ _id: { $in: [runAId, runBId] }, owner: ownerA });
    expect(response.body.comparison.deltas).toEqual({
      rpsDifference: 5,
      rpsPercentageChange: 50,
      p50DifferenceMs: 2,
      p95DifferenceMs: 6,
      errorRateDifferencePoints: 0,
    });
  });

  it('rejects same-run, cross-user/unavailable and incomplete comparisons', async () => {
    expect(
      (await request(createApp(config)).get(`/api/v1/runs/compare?runA=${runAId}&runB=${runAId}`))
        .body.error.code,
    ).toBe('SAME_RUN_COMPARISON');
    mocks.run.find.mockReturnValue(query([completedRun(runAId)]));
    expect(
      (
        await request(createApp(config))
          .get(`/api/v1/runs/compare?runA=${runAId}&runB=${runBId}`)
          .set('x-test-user', ownerB)
      ).status,
    ).toBe(404);
    mocks.run.find.mockReturnValue(
      query([completedRun(runAId), completedRun(runBId, { status: 'RUNNING' })]),
    );
    expect(
      (await request(createApp(config)).get(`/api/v1/runs/compare?runA=${runAId}&runB=${runBId}`))
        .body.error.code,
    ).toBe('RUN_NOT_COMPLETED');
  });
});

describe('completed run exports', () => {
  it('exports owned runs as sanitized JSON', async () => {
    mocks.run.findOne.mockReturnValue(query(completedRun(runAId)));
    const response = await request(createApp(config)).get(
      `/api/v1/runs/${runAId}/export?format=json`,
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('loadlab-run-2026-09-28.json');
    expect(response.body.configuration.requestHeaders).not.toHaveProperty('Authorization');
    expect(response.body.configuration.requestBody).not.toHaveProperty('password');
    expect(JSON.stringify(response.body)).not.toContain('private-jwt');
  });

  it('exports valid escaped CSV and denies unowned runs', async () => {
    mocks.run.findOne.mockReturnValue(query(completedRun(runAId)));
    const exported = await request(createApp(config)).get(
      `/api/v1/runs/${runAId}/export?format=csv`,
    );
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('"Plan, ""quoted"""');
    expect(exported.text).toContain('Snapshots');
    expect(exported.text).toContain('Completed Request Attempts / Second');
    expect(exported.text).toContain('Load Generator CPU %');
    expect(exported.text).toContain('Load Generator Event Loop Max ms');
    expect(exported.text).not.toContain('private-password');
    mocks.run.findOne.mockReturnValue(query(null));
    expect(
      (
        await request(createApp(config))
          .get(`/api/v1/runs/${runAId}/export?format=json`)
          .set('x-test-user', ownerB)
      ).status,
    ).toBe(404);
  });
});

describe('overview analytics', () => {
  it('summarizes only persisted data scoped to the authenticated owner', async () => {
    const recentRun = completedRun(runAId);
    mocks.run.countDocuments.mockImplementation(
      async ({ status }) => ({ COMPLETED: 4, FAILED: 2, CANCELLED: 1 })[status],
    );
    mocks.target.countDocuments.mockResolvedValue(3);
    mocks.run.find.mockReturnValue(query([recentRun]));
    mocks.run.findOne.mockReturnValue(query(recentRun));
    const response = await request(createApp(config)).get('/api/v1/overview');
    expect(response.body.overview.totals).toEqual({
      completedRuns: 4,
      failedRuns: 2,
      cancelledRuns: 1,
      verifiedTargets: 3,
    });
    expect(response.body.overview.latestPerformance).toEqual({
      runId: runAId,
      rps: 10,
      p95LatencyMs: 12,
    });
    expect(response.body.overview.recentPlans[0]).toMatchObject({
      planId,
      name: 'Plan, "quoted"',
    });
    expect(mocks.run.find).toHaveBeenCalledWith({ owner: ownerA });
  });

  it('returns user-scoped counts and clean empty state', async () => {
    const response = await request(createApp(config)).get('/api/v1/overview');
    expect(response.status).toBe(200);
    expect(response.body.overview).toEqual({
      totals: { completedRuns: 0, failedRuns: 0, cancelledRuns: 0, verifiedTargets: 0 },
      recentRuns: [],
      latestPerformance: null,
      recentPlans: [],
    });
    expect(mocks.run.countDocuments).toHaveBeenCalledWith({ owner: ownerA, status: 'COMPLETED' });
    expect(mocks.target.countDocuments).toHaveBeenCalledWith({ owner: ownerA, status: 'VERIFIED' });
  });
});
