import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  },
}));
vi.mock('../models/user.js', () => ({
  User: { findOne: mocks.findOne, findById: mocks.findById, create: mocks.create },
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
  JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-characters',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'refresh-secret-that-is-at-least-32-characters',
  JWT_REFRESH_EXPIRES_IN: '7d',
  GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
};
const userId = '507f1f77bcf86cd799439010';
const user = { _id: userId, name: 'Ada Lovelace', email: 'ada@example.com' };
const credentials = { name: user.name, email: user.email, password: 'StrongPass1' };
const refreshCookieName = 'loadlab_refresh';

function refreshCookie(response) {
  return response.headers['set-cookie']?.find((value) => value.startsWith(`${refreshCookieName}=`));
}

function refreshToken(options = {}) {
  return jwt.sign({ type: 'refresh' }, config.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: '7d',
    ...options,
  });
}

function query(value) {
  return {
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(value),
  };
}

function googlePayload(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: config.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'google-user-123',
    email: 'google@example.com',
    email_verified: true,
    name: 'Google User',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOne.mockReturnValue(query(null));
  mocks.findById.mockReturnValue(query(user));
  mocks.create.mockImplementation(async (value) => ({ _id: userId, ...value }));
  mocks.verifyIdToken.mockResolvedValue({ getPayload: () => googlePayload() });
});

describe('email authentication', () => {
  it('registers a user with a bcrypt password hash and returns a JWT without secrets', async () => {
    let created;
    mocks.create.mockImplementation(async (value) => {
      created = value;
      return { _id: userId, ...value };
    });
    const response = await request(createApp(config))
      .post('/api/v1/auth/register')
      .send(credentials);
    expect(response.status).toBe(201);
    expect(created.password).not.toBe(credentials.password);
    await expect(bcrypt.compare(credentials.password, created.password)).resolves.toBe(true);
    expect(response.body.user).toEqual({ id: userId, name: user.name, email: user.email });
    expect(response.body.password).toBeUndefined();
    expect(jwt.verify(response.body.accessToken, config.JWT_ACCESS_SECRET)).toMatchObject({
      sub: userId,
      type: 'access',
    });
    expect(refreshCookie(response)).toMatch(/HttpOnly/);
    expect(refreshCookie(response)).toMatch(/Path=\/api\/v1\/auth\/refresh/);
    expect(refreshCookie(response)).toMatch(/SameSite=Lax/);
    expect(refreshCookie(response)).not.toMatch(/; Secure/);
    expect(
      jwt.verify(refreshCookie(response).split(';')[0].split('=')[1], config.JWT_REFRESH_SECRET),
    ).toMatchObject({
      sub: userId,
      type: 'refresh',
    });
  });

  it('logs in with the correct password and rejects incorrect credentials generically', async () => {
    const password = await bcrypt.hash(credentials.password, 4);
    mocks.findOne.mockReturnValueOnce(query({ ...user, password }));
    const success = await request(createApp(config))
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: credentials.password });
    expect(success.status).toBe(200);
    expect(refreshCookie(success)).toMatch(/HttpOnly/);
    mocks.findOne.mockReturnValueOnce(query(null));
    const failure = await request(createApp(config))
      .post('/api/v1/auth/login')
      .send({ email: 'missing@example.com', password: credentials.password });
    expect(failure.status).toBe(401);
    expect(failure.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });
  });

  it('rejects duplicate and invalid registrations', async () => {
    mocks.findOne.mockReturnValueOnce(query(user));
    const duplicate = await request(createApp(config))
      .post('/api/v1/auth/register')
      .send(credentials);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EMAIL_EXISTS');
    const invalid = await request(createApp(config))
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'weak' });
    expect(invalid.status).toBe(400);
  });

  it('handles a concurrent duplicate-email database conflict safely', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('duplicate details'), { code: 11000 }));
    const response = await request(createApp(config))
      .post('/api/v1/auth/register')
      .send(credentials);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_EXISTS');
    expect(JSON.stringify(response.body)).not.toContain('details');
  });

  it('rejects missing, expired, invalid and deleted-user JWTs', async () => {
    const app = createApp(config);
    expect((await request(app).get('/api/v1/auth/me')).body.error.code).toBe('AUTH_REQUIRED');
    const expired = jwt.sign({ type: 'access' }, config.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: -1,
    });
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`)).body
        .error.code,
    ).toBe('TOKEN_EXPIRED');
    const invalid = jwt.sign({}, 'another-secret-that-is-at-least-32-chars', {
      subject: userId,
      expiresIn: '1h',
    });
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${invalid}`)).body
        .error.code,
    ).toBe('INVALID_TOKEN');
    mocks.findById.mockReturnValue(query(null));
    const valid = jwt.sign({ type: 'access' }, config.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '1h',
    });
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${valid}`)).body.error
        .code,
    ).toBe('USER_UNAVAILABLE');
  });

  it.each([
    ['GET', '/api/v1/plans'],
    ['POST', `/api/v1/plans/${userId}/runs`],
    ['GET', `/api/v1/runs/${userId}`],
  ])('protects the %s %s management endpoint', async (method, path) => {
    const response = await request(createApp(config))[method.toLowerCase()](path);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('sanitizes authentication database failures', async () => {
    mocks.findOne.mockReturnValue({
      lean: vi.fn().mockRejectedValue(new Error('secret database')),
    });
    const response = await request(createApp(config))
      .post('/api/v1/auth/register')
      .send(credentials);
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});

describe('refresh sessions', () => {
  it('returns a new typed access token from the HttpOnly refresh cookie', async () => {
    const response = await request(createApp(config))
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshCookieName}=${refreshToken()}`);
    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: userId, name: user.name, email: user.email });
    expect(jwt.verify(response.body.accessToken, config.JWT_ACCESS_SECRET)).toMatchObject({
      sub: userId,
      type: 'access',
    });
  });

  it('requires a cookie and rejects invalid, expired and access tokens', async () => {
    const app = createApp(config);
    expect((await request(app).post('/api/v1/auth/refresh')).body.error.code).toBe(
      'REFRESH_REQUIRED',
    );
    const invalid = jwt.sign({ type: 'refresh' }, 'different-refresh-secret-at-least-32-chars', {
      subject: userId,
      expiresIn: '7d',
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${refreshCookieName}=${invalid}`)
      ).body.error.code,
    ).toBe('INVALID_REFRESH_TOKEN');
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${refreshCookieName}=${refreshToken({ expiresIn: -1 })}`)
      ).body.error.code,
    ).toBe('REFRESH_EXPIRED');
    const access = jwt.sign({ type: 'access' }, config.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '15m',
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${refreshCookieName}=${access}`)
      ).body.error.code,
    ).toBe('INVALID_REFRESH_TOKEN');
  });

  it('does not allow a refresh token to access protected REST routes', async () => {
    const response = await request(createApp(config))
      .get('/api/v1/plans')
      .set('Authorization', `Bearer ${refreshToken()}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects refresh for a deleted user and logout clears the matching cookie', async () => {
    mocks.findById.mockReturnValueOnce(query(null));
    const unavailable = await request(createApp(config))
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshCookieName}=${refreshToken()}`);
    expect(unavailable.body.error.code).toBe('USER_UNAVAILABLE');

    const logout = await request(createApp(config)).post('/api/v1/auth/logout');
    expect(logout.status).toBe(204);
    expect(refreshCookie(logout)).toMatch(/loadlab_refresh=;/);
    expect(refreshCookie(logout)).toMatch(/Path=\/api\/v1\/auth\/refresh/);
  });
});

describe('Google authentication', () => {
  it('creates a first-time Google user without a password', async () => {
    let created;
    mocks.create.mockImplementation(async (value) => {
      created = value;
      return { _id: userId, ...value };
    });
    const response = await request(createApp({ ...config, NODE_ENV: 'production' }))
      .post('/api/v1/auth/google')
      .send({ credential: 'verified-google-id-token' });
    expect(response.status).toBe(201);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'verified-google-id-token',
      audience: config.GOOGLE_CLIENT_ID,
    });
    expect(created).toEqual({
      googleId: 'google-user-123',
      email: 'google@example.com',
      name: 'Google User',
    });
    expect(created.password).toBeUndefined();
    expect(refreshCookie(response)).toMatch(/HttpOnly/);
    expect(refreshCookie(response)).toMatch(/; Secure/);
    expect(refreshCookie(response)).toMatch(/SameSite=Lax/);
  });

  it('returns an existing user found by the stable Google subject', async () => {
    mocks.findOne.mockImplementation((filter) =>
      query(filter.googleId ? { ...user, googleId: filter.googleId } : null),
    );
    const response = await request(createApp(config))
      .post('/api/v1/auth/google')
      .send({ credential: 'returning-token' });
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(userId);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong audience', { aud: 'wrong-client' }, 'GOOGLE_TOKEN_INVALID'],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 1 }, 'GOOGLE_TOKEN_INVALID'],
    ['unverified email', { email_verified: false }, 'GOOGLE_EMAIL_UNVERIFIED'],
  ])('rejects a %s', async (_label, override, code) => {
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => googlePayload(override) });
    const response = await request(createApp(config))
      .post('/api/v1/auth/google')
      .send({ credential: 'bad-google-token' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(code);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects invalid Google signatures and verification failures', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('invalid signature details'));
    const response = await request(createApp(config))
      .post('/api/v1/auth/google')
      .send({ credential: 'invalid-token' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('GOOGLE_TOKEN_INVALID');
    expect(JSON.stringify(response.body)).not.toContain('details');
  });

  it('does not automatically merge a matching password account', async () => {
    mocks.findOne.mockImplementation((filter) => query(filter.email ? user : null));
    const response = await request(createApp(config))
      .post('/api/v1/auth/google')
      .send({ credential: 'collision-token' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACCOUNT_METHOD_CONFLICT');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('recovers a concurrent Google registration by its stable Google ID', async () => {
    let googleLookups = 0;
    mocks.findOne.mockImplementation((filter) => {
      if (filter.googleId) {
        googleLookups += 1;
        return query(googleLookups === 1 ? null : { ...user, googleId: filter.googleId });
      }
      return query(null);
    });
    mocks.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    const response = await request(createApp(config))
      .post('/api/v1/auth/google')
      .send({ credential: 'concurrent-token' });
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(userId);
  });
});
