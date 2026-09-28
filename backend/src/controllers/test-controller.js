import mongoose from 'mongoose';
import { z } from 'zod';
import { createHttpError } from '../middleware/error.js';
import { TestPlan } from '../models/test-plan.js';
import { ACTIVE_RUN_STATUSES, TestRun } from '../models/test-run.js';
import { cancelTestRun, startTestRun } from '../services/test-runner.js';

const planSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    targetUrl: z.url(),
    virtualUsers: z.number().int().min(1).max(1000),
    durationMs: z.number().int().min(50).max(300_000),
    rampUpMs: z.number().int().min(0).max(60_000),
    requestTimeoutMs: z.number().int().min(10).max(30_000),
    maxConnections: z.number().int().min(1).max(100),
    requestsPerSecond: z.number().int().min(1).max(5_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rampUpMs >= value.durationMs) {
      context.addIssue({ code: 'custom', path: ['rampUpMs'], message: 'Must be below duration.' });
    }
    if (value.maxConnections > value.virtualUsers) {
      context.addIssue({
        code: 'custom',
        path: ['maxConnections'],
        message: 'Cannot exceed virtual users.',
      });
    }
  });

function validateTarget(targetUrl, mockServerOrigin) {
  const target = new URL(targetUrl);
  if (
    target.origin !== mockServerOrigin ||
    !['/fast', '/slow', '/variable', '/flaky'].includes(target.pathname) ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw createHttpError(
      400,
      'INVALID_TARGET',
      'Target must be an allowed endpoint on the configured local mock server.',
    );
  }
}

function parsePlan(value, mockServerOrigin) {
  const result = planSchema.safeParse(value);
  if (!result.success) {
    throw createHttpError(400, 'VALIDATION_ERROR', 'Test plan configuration is invalid.');
  }
  validateTarget(result.data.targetUrl, mockServerOrigin);
  return result.data;
}

function requireId(value) {
  if (!mongoose.isValidObjectId(value)) {
    throw createHttpError(400, 'INVALID_ID', 'Resource ID is invalid.');
  }
}

export async function createPlan(req, res, next) {
  try {
    const input = parsePlan(req.body, req.app.locals.config.MOCK_SERVER_URL);
    const plan = await TestPlan.create({ ...input, owner: req.auth.userId });
    return res.status(201).json({ plan });
  } catch (error) {
    return next(error);
  }
}

export async function listPlans(req, res, next) {
  try {
    const plans = await TestPlan.find({ owner: req.auth.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ plans });
  } catch (error) {
    return next(error);
  }
}

export async function getPlan(req, res, next) {
  try {
    requireId(req.params.planId);
    const plan = await TestPlan.findOne({
      _id: req.params.planId,
      owner: req.auth.userId,
    }).lean();
    if (!plan) throw createHttpError(404, 'PLAN_NOT_FOUND', 'Test plan was not found.');
    return res.json({ plan });
  } catch (error) {
    return next(error);
  }
}

export async function updatePlan(req, res, next) {
  try {
    requireId(req.params.planId);
    const current = await TestPlan.findOne({
      _id: req.params.planId,
      owner: req.auth.userId,
    }).lean();
    if (!current) throw createHttpError(404, 'PLAN_NOT_FOUND', 'Test plan was not found.');
    if (!req.body || Object.keys(req.body).length === 0) {
      throw createHttpError(400, 'VALIDATION_ERROR', 'At least one plan field is required.');
    }
    const merged = parsePlan(
      {
        name: current.name,
        targetUrl: current.targetUrl,
        virtualUsers: current.virtualUsers,
        durationMs: current.durationMs,
        rampUpMs: current.rampUpMs,
        requestTimeoutMs: current.requestTimeoutMs,
        maxConnections: current.maxConnections,
        requestsPerSecond: current.requestsPerSecond,
        ...req.body,
      },
      req.app.locals.config.MOCK_SERVER_URL,
    );
    const plan = await TestPlan.findOneAndUpdate(
      { _id: req.params.planId, owner: req.auth.userId },
      merged,
      { new: true, runValidators: true },
    );
    return res.json({ plan });
  } catch (error) {
    return next(error);
  }
}

export async function deletePlan(req, res, next) {
  try {
    requireId(req.params.planId);
    if (
      await TestRun.exists({
        plan: req.params.planId,
        owner: req.auth.userId,
        status: { $in: ACTIVE_RUN_STATUSES },
      })
    ) {
      throw createHttpError(409, 'PLAN_ACTIVE', 'Cannot delete a plan with an active test.');
    }
    const plan = await TestPlan.findOneAndDelete({
      _id: req.params.planId,
      owner: req.auth.userId,
    });
    if (!plan) throw createHttpError(404, 'PLAN_NOT_FOUND', 'Test plan was not found.');
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

export async function startRun(req, res, next) {
  try {
    requireId(req.params.planId);
    const run = await startTestRun(
      req.params.planId,
      req.auth.userId,
      req.app.locals.config.MOCK_SERVER_URL,
    );
    return res.status(202).json({ runId: run._id, status: run.status });
  } catch (error) {
    return next(error);
  }
}

export async function cancelRun(req, res, next) {
  try {
    requireId(req.params.runId);
    await cancelTestRun(req.params.runId, req.auth.userId);
    return res.status(202).json({ runId: req.params.runId, cancellationRequested: true });
  } catch (error) {
    return next(error);
  }
}

export async function getRun(req, res, next) {
  try {
    requireId(req.params.runId);
    const run = await TestRun.findOne({
      _id: req.params.runId,
      owner: req.auth.userId,
    }).lean();
    if (!run) throw createHttpError(404, 'RUN_NOT_FOUND', 'Test run was not found.');
    return res.json({ run });
  } catch (error) {
    return next(error);
  }
}

export async function listRuns(req, res, next) {
  try {
    const filter = { owner: req.auth.userId };
    if (req.query.planId) {
      requireId(req.query.planId);
      filter.plan = req.query.planId;
    }
    const runs = await TestRun.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ runs });
  } catch (error) {
    return next(error);
  }
}
