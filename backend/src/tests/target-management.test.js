import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  target: {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndDelete: vi.fn(),
  },
  verifyTargetOwnership: vi.fn(),
}));

const ownerA = '507f1f77bcf86cd799439010';
const ownerB = '507f1f77bcf86cd799439020';
const targetId = '507f1f77bcf86cd799439030';

vi.mock('../middleware/auth.js', () => ({
  authenticate(req, _res, next) {
    const userId = req.get('x-test-user') ?? ownerA;
    req.auth = { userId, user: { _id: userId } };
    next();
  },
  createAccessToken: vi.fn(() => 'access'),
  createRefreshToken: vi.fn(() => 'refresh'),
  verifyRefreshToken: vi.fn(),
}));
vi.mock('../models/target.js', () => ({
  TARGET_STATUS: { PENDING: 'PENDING', VERIFIED: 'VERIFIED' },
  Target: mocks.target,
}));
vi.mock('../services/safe-target.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyTargetOwnership: mocks.verifyTargetOwnership,
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

function target(overrides = {}) {
  const value = {
    _id: targetId,
    owner: ownerA,
    name: 'Owned API',
    baseUrl: 'https://api.example.com',
    hostname: 'api.example.com',
    verificationToken: 'a'.repeat(64),
    status: 'PENDING',
    ...overrides,
  };
  return {
    ...value,
    toObject: () => ({ ...value }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function list(value) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }),
    }),
  };
}

function query(value) {
  return {
    lean: vi.fn().mockResolvedValue(value?.toObject ? value.toObject() : value),
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const owned = target();
  mocks.target.create.mockImplementation(async (value) => target({ ...value, _id: targetId }));
  mocks.target.find.mockReturnValue(list([owned.toObject()]));
  mocks.target.findOne.mockReturnValue(query(owned));
  mocks.target.findOneAndDelete.mockResolvedValue(owned);
  mocks.verifyTargetOwnership.mockResolvedValue(true);
});

describe('verified target management API', () => {
  it('creates and lists targets only for the authenticated owner', async () => {
    const app = createApp(config);
    const created = await request(app)
      .post('/api/v1/targets')
      .send({ name: 'Owned API', baseUrl: 'https://api.example.com' });
    expect(created.status).toBe(201);
    expect(created.body.target.verificationToken).toMatch(/^[a-f\d]{64}$/);
    expect(created.body.target.verificationUrl).toBe(
      'https://api.example.com/.well-known/loadlab-verification.txt',
    );
    expect(mocks.target.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: ownerA, hostname: 'api.example.com', status: 'PENDING' }),
    );
    const listed = await request(app).get('/api/v1/targets');
    expect(listed.body.targets).toHaveLength(1);
    expect(mocks.target.find).toHaveBeenCalledWith({ owner: ownerA });
  });

  it('verifies only a target selected through an owner-scoped query', async () => {
    const owned = target();
    mocks.target.findOne.mockReturnValue(query(owned));
    const response = await request(createApp(config)).post(`/api/v1/targets/${targetId}/verify`);
    expect(response.status).toBe(200);
    expect(mocks.target.findOne).toHaveBeenCalledWith({ _id: targetId, owner: ownerA });
    expect(mocks.verifyTargetOwnership).toHaveBeenCalledWith(
      owned.baseUrl,
      owned.verificationToken,
    );
    expect(owned.status).toBe('VERIFIED');
    expect(owned.save).toHaveBeenCalled();
  });

  it('does not expose, verify or delete another user target', async () => {
    mocks.target.findOne.mockReturnValue(query(null));
    mocks.target.findOneAndDelete.mockResolvedValue(null);
    const app = createApp(config);
    expect(
      (await request(app).get(`/api/v1/targets/${targetId}`).set('x-test-user', ownerB)).status,
    ).toBe(404);
    expect(
      (await request(app).post(`/api/v1/targets/${targetId}/verify`).set('x-test-user', ownerB))
        .status,
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/v1/targets/${targetId}`).set('x-test-user', ownerB)).status,
    ).toBe(404);
    expect(mocks.verifyTargetOwnership).not.toHaveBeenCalled();
  });

  it('rejects unsafe target creation before persistence', async () => {
    const response = await request(createApp(config))
      .post('/api/v1/targets')
      .send({ name: 'Localhost', baseUrl: 'http://127.0.0.1' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('TARGET_FORBIDDEN');
    expect(mocks.target.create).not.toHaveBeenCalled();
  });
});
