import { setImmediate } from 'node:timers';
import { logger, errorKind } from '../config/logger.js';
import { TestPlan } from '../models/test-plan.js';
import { ACTIVE_RUN_STATUSES, RUN_STATUS, TestRun } from '../models/test-run.js';
import { runLoadTest } from './loadEngine.js';

const MAX_SNAPSHOTS = 60;
let starting = false;
let activeExecution;

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
      return;
    }

    const running = await transition(runId, [RUN_STATUS.QUEUED], RUN_STATUS.RUNNING, {
      startedAt: new Date(),
    });
    if (!running) return;

    const finalMetrics = await runLoadTest({
      ...configuration,
      mockServerOrigin,
      signal: execution.controller.signal,
      snapshotIntervalMs: 5_000,
      async onSnapshot(metrics) {
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
    await transition(runId, [RUN_STATUS.RUNNING], status, {
      finalMetrics,
      finishedAt: new Date(),
      ...(status === RUN_STATUS.CANCELLED
        ? { reason: execution.cancellationReason ?? 'Cancelled by user.' }
        : {}),
    });
  } catch (error) {
    logger.error({ event: 'test_run_failed', runId, kind: errorKind(error) });
    try {
      await transition(runId, ACTIVE_RUN_STATUSES, RUN_STATUS.FAILED, {
        finishedAt: new Date(),
        reason: `Execution failed (${errorKind(error)}).`,
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

export async function startTestRun(planId, mockServerOrigin) {
  if (starting || activeExecution) {
    throw serviceError(409, 'TEST_ALREADY_ACTIVE', 'Another test is already active.');
  }
  starting = true;

  try {
    const plan = await TestPlan.findById(planId).lean();
    if (!plan) throw serviceError(404, 'PLAN_NOT_FOUND', 'Test plan was not found.');
    const configuration = snapshotPlan(plan);
    const run = await TestRun.create({
      plan: plan._id,
      configurationSnapshot: configuration,
      status: RUN_STATUS.QUEUED,
      queuedAt: new Date(),
    });
    const execution = {
      runId: String(run._id),
      controller: new AbortController(),
      cancellationReason: undefined,
    };
    activeExecution = execution;
    setImmediate(
      () => void executeRun(execution.runId, configuration, mockServerOrigin, execution),
    );
    return run;
  } finally {
    starting = false;
  }
}

export async function cancelTestRun(runId) {
  if (activeExecution?.runId === String(runId)) {
    activeExecution.cancellationReason = 'Cancelled by user.';
    activeExecution.controller.abort();
    return;
  }

  const run = await TestRun.findById(runId).lean();
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
