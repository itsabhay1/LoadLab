import { setImmediate } from 'node:timers';
import { EventEmitter } from 'node:events';
import { logger, errorKind } from '../config/logger.js';
import { TestPlan } from '../models/test-plan.js';
import { ACTIVE_RUN_STATUSES, RUN_STATUS, TestRun } from '../models/test-run.js';
import { runLoadTest } from './loadEngine.js';

const MAX_SNAPSHOTS = 60;
const LIVE_SNAPSHOT_INTERVAL_MS = 1_000;
const DATABASE_SNAPSHOT_INTERVAL_MS = 5_000;
let starting = false;
let activeExecution;

export const testRunEvents = new EventEmitter();

function publishRunUpdate(runId, status, values = {}) {
  testRunEvents.emit('run:update', {
    runId: String(runId),
    status,
    capturedAt: new Date().toISOString(),
    ...values,
  });
}

function serviceError(status, code, message) {
  return Object.assign(new Error(message), { status, code, publicMessage: message });
}

function snapshotPlan(plan) {
  return {
    name: plan.name,
    targetUrl: plan.targetUrl,
    virtualUsers: plan.virtualUsers,
    durationMs: plan.durationMs,
    rampUpMs: plan.rampUpMs,
    requestTimeoutMs: plan.requestTimeoutMs,
    maxConnections: plan.maxConnections,
    requestsPerSecond: plan.requestsPerSecond,
  };
}

async function transition(runId, from, status, values = {}) {
  return TestRun.findOneAndUpdate(
    { _id: runId, status: { $in: from } },
    { $set: { status, ...values } },
    { new: true, runValidators: true },
  );
}

async function executeRun(runId, configuration, mockServerOrigin, execution) {
  try {
    if (execution.controller.signal.aborted) {
      await transition(runId, [RUN_STATUS.QUEUED], RUN_STATUS.CANCELLED, {
        finishedAt: new Date(),
        reason: execution.cancellationReason,
      });
      publishRunUpdate(runId, RUN_STATUS.CANCELLED, {
        reason: execution.cancellationReason,
      });
      return;
    }

    const running = await transition(runId, [RUN_STATUS.QUEUED], RUN_STATUS.RUNNING, {
      startedAt: new Date(),
    });
    if (!running) return;
    publishRunUpdate(runId, RUN_STATUS.RUNNING, {
      startedAt: running.startedAt?.toISOString?.() ?? new Date().toISOString(),
    });

    let lastPersistedElapsedMs = 0;

    const finalMetrics = await runLoadTest({
      ...configuration,
      mockServerOrigin,
      signal: execution.controller.signal,
      snapshotIntervalMs: LIVE_SNAPSHOT_INTERVAL_MS,
      async onSnapshot(metrics) {
        publishRunUpdate(runId, RUN_STATUS.RUNNING, { metrics });
        if (metrics.elapsedMs - lastPersistedElapsedMs < DATABASE_SNAPSHOT_INTERVAL_MS) return;
        lastPersistedElapsedMs = metrics.elapsedMs;
        await TestRun.updateOne(
          { _id: runId, status: RUN_STATUS.RUNNING },
          {
            $push: {
              snapshots: {
                $each: [{ capturedAt: new Date(), metrics }],
                $slice: -MAX_SNAPSHOTS,
              },
            },
          },
        );
      },
    });

    const status = finalMetrics.cancelled ? RUN_STATUS.CANCELLED : RUN_STATUS.COMPLETED;
    const finishedAt = new Date();
    await transition(runId, [RUN_STATUS.RUNNING], status, {
      finalMetrics,
      finishedAt,
      ...(status === RUN_STATUS.CANCELLED
        ? { reason: execution.cancellationReason ?? 'Cancelled by user.' }
        : {}),
    });
    publishRunUpdate(runId, status, {
      metrics: finalMetrics,
      finishedAt: finishedAt.toISOString(),
      ...(status === RUN_STATUS.CANCELLED
        ? { reason: execution.cancellationReason ?? 'Cancelled by user.' }
        : {}),
    });
  } catch (error) {
    logger.error({ event: 'test_run_failed', runId, kind: errorKind(error) });
    try {
      const finishedAt = new Date();
      const reason = `Execution failed (${errorKind(error)}).`;
      await transition(runId, ACTIVE_RUN_STATUSES, RUN_STATUS.FAILED, {
        finishedAt,
        reason,
      });
      publishRunUpdate(runId, RUN_STATUS.FAILED, {
        finishedAt: finishedAt.toISOString(),
        reason,
      });
    } catch (persistenceError) {
      logger.error({
        event: 'test_run_failure_persistence_failed',
        runId,
        kind: errorKind(persistenceError),
      });
    }
  } finally {
    if (activeExecution?.runId === runId) activeExecution = undefined;
  }
}

export async function startTestRun(planId, ownerId, mockServerOrigin) {
  if (starting || activeExecution) {
    throw serviceError(409, 'TEST_ALREADY_ACTIVE', 'Another test is already active.');
  }
  starting = true;

  try {
    const plan = await TestPlan.findOne({ _id: planId, owner: ownerId }).lean();
    if (!plan) throw serviceError(404, 'PLAN_NOT_FOUND', 'Test plan was not found.');
    const configuration = snapshotPlan(plan);
    const run = await TestRun.create({
      plan: plan._id,
      owner: ownerId,
      configurationSnapshot: configuration,
      status: RUN_STATUS.QUEUED,
      queuedAt: new Date(),
    });
    const execution = {
      runId: String(run._id),
      controller: new AbortController(),
      cancellationReason: undefined,
      ownerId: String(ownerId),
    };
    activeExecution = execution;
    publishRunUpdate(execution.runId, RUN_STATUS.QUEUED, {
      queuedAt: run.queuedAt?.toISOString?.() ?? new Date().toISOString(),
    });
    setImmediate(
      () => void executeRun(execution.runId, configuration, mockServerOrigin, execution),
    );
    return run;
  } finally {
    starting = false;
  }
}

export async function cancelTestRun(runId, ownerId) {
  if (activeExecution?.runId === String(runId)) {
    if (activeExecution.ownerId !== String(ownerId)) {
      throw serviceError(404, 'RUN_NOT_FOUND', 'Test run was not found.');
    }
    activeExecution.cancellationReason = 'Cancelled by user.';
    activeExecution.controller.abort();
    return;
  }

  const run = await TestRun.findOne({ _id: runId, owner: ownerId }).lean();
  if (!run) throw serviceError(404, 'RUN_NOT_FOUND', 'Test run was not found.');
  if (!ACTIVE_RUN_STATUSES.includes(run.status)) {
    throw serviceError(409, 'RUN_NOT_ACTIVE', 'Test run is not active.');
  }
  throw serviceError(409, 'RUN_NOT_OWNED', 'Test run is not active in this process.');
}

export async function recoverInterruptedRuns() {
  const result = await TestRun.updateMany(
    { status: { $in: ACTIVE_RUN_STATUSES } },
    {
      $set: {
        status: RUN_STATUS.INTERRUPTED,
        finishedAt: new Date(),
        reason: 'Application restarted before the test completed.',
      },
    },
  );
  return result.modifiedCount;
}

export function hasActiveTest() {
  return starting || Boolean(activeExecution);
}
