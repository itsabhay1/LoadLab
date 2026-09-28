import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createHttpError } from './error.js';
import { User } from '../models/user.js';

const TOKEN_ALGORITHM = 'HS256';
const ACCESS_TOKEN_TYPE = 'access';
const REFRESH_TOKEN_TYPE = 'refresh';

export function createAccessToken(userId, config) {
  return jwt.sign({ type: ACCESS_TOKEN_TYPE }, config.JWT_ACCESS_SECRET, {
    algorithm: TOKEN_ALGORITHM,
    subject: String(userId),
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
  });
}

export function createRefreshToken(userId, config) {
  return jwt.sign({ type: REFRESH_TOKEN_TYPE }, config.JWT_REFRESH_SECRET, {
    algorithm: TOKEN_ALGORITHM,
    subject: String(userId),
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
  });
}

function verifyToken(token, secret, expectedType) {
  const payload = jwt.verify(token, secret, { algorithms: [TOKEN_ALGORITHM] });
  if (
    typeof payload !== 'object' ||
    payload.type !== expectedType ||
    typeof payload.sub !== 'string' ||
    !mongoose.isValidObjectId(payload.sub) ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp)
  ) {
    throw new jwt.JsonWebTokenError('Invalid token claims.');
  }
  return payload;
}

export function verifyAccessToken(token, config) {
  return verifyToken(token, config.JWT_ACCESS_SECRET, ACCESS_TOKEN_TYPE);
}

export function verifyRefreshToken(token, config) {
  return verifyToken(token, config.JWT_REFRESH_SECRET, REFRESH_TOKEN_TYPE);
}

export function tokenFromAuthorization(header) {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1];
}

export async function authenticate(req, _res, next) {
  const token = tokenFromAuthorization(req.get('authorization'));
  if (!token) {
    return next(createHttpError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
  }

  let payload;
  try {
    payload = verifyAccessToken(token, req.app.locals.config);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(createHttpError(401, 'TOKEN_EXPIRED', 'Your session has expired.'));
    }
    return next(createHttpError(401, 'INVALID_TOKEN', 'The access token is invalid.'));
  }

  try {
    const user = await User.findById(payload.sub).select('_id name email').lean();
    if (!user) {
      return next(
        createHttpError(401, 'USER_UNAVAILABLE', 'The authenticated user is unavailable.'),
      );
    }
    req.auth = { userId: String(user._id), user, expiresAt: payload.exp * 1000 };
    return next();
  } catch (error) {
    return next(error);
  }
}
