import { describe, expect, it } from 'vitest';
import { TestPlan } from '../models/test-plan.js';
import { RUN_STATUS, TestRun } from '../models/test-run.js';

const configuration = {
  name: 'Plan',
  targetUrl: 'http://127.0.0.1:5050/fast',
  virtualUsers: 1000,
  durationMs: 60_000,
  rampUpMs: 15_000,
  requestTimeoutMs: 5_000,
  maxConnections: 100,
  requestsPerSecond: 5_000,
};

describe('test management models', () => {
  it('validates plan and run documents without a database connection', async () => {
    await expect(new TestPlan(configuration).validate()).resolves.toBeUndefined();
    await expect(
      new TestRun({
        plan: '507f1f77bcf86cd799439011',
        configurationSnapshot: configuration,
        status: RUN_STATUS.QUEUED,
      }).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects plan values above verified engine limits', async () => {
    const plan = new TestPlan({ ...configuration, virtualUsers: 1001 });
    await expect(plan.validate()).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects unknown run states', async () => {
    const run = new TestRun({
      plan: '507f1f77bcf86cd799439011',
      configurationSnapshot: configuration,
      status: 'PAUSED',
    });
    await expect(run.validate()).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
