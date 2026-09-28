import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { createHttpError } from '../middleware/error.js';
import { createAccessToken, createRefreshToken, verifyRefreshToken } from '../middleware/auth.js';
import { User } from '../models/user.js';

export const REFRESH_COOKIE_NAME = 'loadlab_refresh';
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
const googleClient = new OAuth2Client();
const passwordSchema = z.string().min(8).max(72).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);
const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: passwordSchema,
  })
  .strict();
const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(72),
  })
  .strict();
const googleSchema = z.object({ credential: z.string().min(1).max(10_000) }).strict();
const DUMMY_PASSWORD_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxQJ7t9Jw1bD8dX4q4zU4.fYl5u';

function parse(schema, input, message) {
  const result = schema.safeParse(input);
  if (!result.success) throw createHttpError(400, 'VALIDATION_ERROR', message);
  return result.data;
}

function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

function authResponse(user, config) {
  return { accessToken: createAccessToken(user._id, config), user: publicUser(user) };
}

function durationToMilliseconds(value) {
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number.parseInt(value.slice(0, -1), 10) * units[value.at(-1)];
}

function refreshCookieOptions(config, persistent = true) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    ...(persistent ? { maxAge: durationToMilliseconds(config.JWT_REFRESH_EXPIRES_IN) } : {}),
  };
}

function refreshTokenFromCookie(header) {
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sendAuthentication(res, user, config, status = 200) {
  res.cookie(
    REFRESH_COOKIE_NAME,
    createRefreshToken(user._id, config),
    refreshCookieOptions(config),
  );
  return res.status(status).json(authResponse(user, config));
}

export async function register(req, res, next) {
  try {
    const input = parse(
      registerSchema,
      req.body,
      'Name, a valid email and a strong password are required.',
    );
    if (await User.findOne({ email: input.email }).lean()) {
      throw createHttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }
    const password = await bcrypt.hash(input.password, 12);
    let user;
    try {
      user = await User.create({ name: input.name, email: input.email, password });
    } catch (error) {
      if (error.code === 11000) {
        throw createHttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
      }
      throw error;
    }
    return sendAuthentication(res, user, req.app.locals.config, 201);
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const input = parse(loginSchema, req.body, 'A valid email and password are required.');
    const user = await User.findOne({ email: input.email }).select('+password').lean();
    const valid = await bcrypt.compare(input.password, user?.password ?? DUMMY_PASSWORD_HASH);
    if (!user || !user.password || !valid) {
      throw createHttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    return sendAuthentication(res, user, req.app.locals.config);
  } catch (error) {
    return next(error);
  }
}

export function me(req, res) {
  return res.json({ user: publicUser(req.auth.user) });
}

export async function refresh(req, res, next) {
  try {
    const token = refreshTokenFromCookie(req.get('cookie'));
    if (!token) {
      throw createHttpError(401, 'REFRESH_REQUIRED', 'A valid refresh session is required.');
    }
    let payload;
    try {
      payload = verifyRefreshToken(token, req.app.locals.config);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw createHttpError(401, 'REFRESH_EXPIRED', 'The refresh session has expired.');
      }
      throw createHttpError(401, 'INVALID_REFRESH_TOKEN', 'The refresh session is invalid.');
    }
    const user = await User.findById(payload.sub).select('_id name email').lean();
    if (!user) {
      throw createHttpError(401, 'USER_UNAVAILABLE', 'The authenticated user is unavailable.');
    }
    return res.json(authResponse(user, req.app.locals.config));
  } catch (error) {
    return next(error);
  }
}

export function logout(req, res) {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(req.app.locals.config, false));
  return res.status(204).end();
}

function validateGooglePayload(payload, clientId) {
  const issuerAllowed = ['accounts.google.com', 'https://accounts.google.com'].includes(
    payload?.iss,
  );
  if (
    !payload ||
    payload.aud !== clientId ||
    !issuerAllowed ||
    !Number.isInteger(payload.exp) ||
    payload.exp * 1000 <= Date.now() ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.email !== 'string'
  ) {
    throw createHttpError(
      401,
      'GOOGLE_TOKEN_INVALID',
      'Google authentication could not be verified.',
    );
  }
  if (payload.email_verified !== true) {
    throw createHttpError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'The Google email is not verified.');
  }
  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: payload.name?.trim() || payload.email.split('@')[0],
  };
}

async function findGoogleUser(googleId) {
  return User.findOne({ googleId }).select('+googleId').lean();
}

export async function google(req, res, next) {
  try {
    const { credential } = parse(googleSchema, req.body, 'A Google ID token is required.');
    const clientId = req.app.locals.config.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw createHttpError(503, 'GOOGLE_NOT_CONFIGURED', 'Google Sign-In is not configured.');
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    } catch {
      throw createHttpError(
        401,
        'GOOGLE_TOKEN_INVALID',
        'Google authentication could not be verified.',
      );
    }
    const identity = validateGooglePayload(ticket.getPayload(), clientId);
    const existingGoogleUser = await findGoogleUser(identity.googleId);
    if (existingGoogleUser) {
      return sendAuthentication(res, existingGoogleUser, req.app.locals.config);
    }
    if (await User.findOne({ email: identity.email }).lean()) {
      throw createHttpError(
        409,
        'ACCOUNT_METHOD_CONFLICT',
        'An account with this email already exists. Sign in using its existing method.',
      );
    }

    let user;
    try {
      user = await User.create(identity);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const concurrentGoogleUser = await findGoogleUser(identity.googleId);
      if (concurrentGoogleUser) {
        return sendAuthentication(res, concurrentGoogleUser, req.app.locals.config);
      }
      throw createHttpError(
        409,
        'ACCOUNT_METHOD_CONFLICT',
        'An account with this email already exists. Sign in using its existing method.',
      );
    }
    return sendAuthentication(res, user, req.app.locals.config, 201);
  } catch (error) {
    return next(error);
  }
}
