import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { createHttpError } from '../middleware/error.js';
import { Target, TARGET_STATUS } from '../models/target.js';
import {
  normalizeExternalBaseUrl,
  TargetSafetyError,
  verifyTargetOwnership,
  VERIFICATION_ENDPOINT_PATH,
} from '../services/safe-target.js';

const createTargetSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().min(1).max(2_048),
  })
  .strict();

function requireId(value) {
  if (!mongoose.isValidObjectId(value)) {
    throw createHttpError(400, 'INVALID_ID', 'Resource ID is invalid.');
  }
}

function targetError(error) {
  if (!(error instanceof TargetSafetyError)) return error;
  const status = ['VERIFICATION_MISMATCH', 'VERIFICATION_UNAVAILABLE', 'TARGET_TIMEOUT'].includes(
    error.code,
  )
    ? 422
    : 400;
  return createHttpError(status, error.code, error.message);
}

function publicTarget(target) {
  const value = target.toObject ? target.toObject() : target;
  return {
    ...value,
    verificationUrl: `${value.baseUrl}${VERIFICATION_ENDPOINT_PATH}`,
  };
}

export async function createTarget(req, res, next) {
  try {
    const parsed = createTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createHttpError(400, 'VALIDATION_ERROR', 'Target name and base URL are required.');
    }
    const normalized = normalizeExternalBaseUrl(parsed.data.baseUrl);
    let target;
    try {
      target = await Target.create({
        owner: req.auth.userId,
        name: parsed.data.name,
        ...normalized,
        verificationToken: randomBytes(32).toString('hex'),
        status: TARGET_STATUS.PENDING,
      });
    } catch (error) {
      if (error.code === 11000) {
        throw createHttpError(409, 'TARGET_EXISTS', 'This target already exists in your account.');
      }
      throw error;
    }
    return res.status(201).json({ target: publicTarget(target) });
  } catch (error) {
    return next(targetError(error));
  }
}

export async function listTargets(req, res, next) {
  try {
    const targets = await Target.find({ owner: req.auth.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ targets: targets.map(publicTarget) });
  } catch (error) {
    return next(error);
  }
}

export async function getTarget(req, res, next) {
  try {
    requireId(req.params.targetId);
    const target = await Target.findOne({
      _id: req.params.targetId,
      owner: req.auth.userId,
    }).lean();
    if (!target) throw createHttpError(404, 'TARGET_NOT_FOUND', 'Target was not found.');
    return res.json({ target: publicTarget(target) });
  } catch (error) {
    return next(error);
  }
}

export async function verifyTarget(req, res, next) {
  try {
    requireId(req.params.targetId);
    const target = await Target.findOne({
      _id: req.params.targetId,
      owner: req.auth.userId,
    });
    if (!target) throw createHttpError(404, 'TARGET_NOT_FOUND', 'Target was not found.');
    target.status = TARGET_STATUS.PENDING;
    target.verifiedAt = undefined;
    await target.save();
    await verifyTargetOwnership(target.baseUrl, target.verificationToken);
    target.status = TARGET_STATUS.VERIFIED;
    target.verifiedAt = new Date();
    await target.save();
    return res.json({ target: publicTarget(target) });
  } catch (error) {
    return next(targetError(error));
  }
}

export async function deleteTarget(req, res, next) {
  try {
    requireId(req.params.targetId);
    const target = await Target.findOneAndDelete({
      _id: req.params.targetId,
      owner: req.auth.userId,
    });
    if (!target) throw createHttpError(404, 'TARGET_NOT_FOUND', 'Target was not found.');
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}
