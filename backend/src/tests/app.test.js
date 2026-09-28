import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../app.js';
import { errorHandler } from '../middleware/error.js';
import { requestLogger } from '../middleware/request.js';
import { isDatabaseReady } from '../config/database.js';
import { logger } from '../config/logger.js';

vi.mock('../config/database.js', () => ({ isDatabaseReady: vi.fn() }));
vi.mock('../config/logger.js', async (importOriginal) => ({
  ...(await importOriginal()),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config = { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173' };
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function setup(ready = true) {
  isDatabaseReady.mockResolvedValue(ready);
  return createApp(config);
}

describe('HTTP foundation', () => {
  it('health reports liveness without touching the database', async () => {
    const app = setup(false);
    const res = await request(app).get('/api/v1/health').set('X-Request-ID', 'untrusted');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'loadlab-api' });
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    expect(res.headers['x-request-id']).toMatch(/^[\da-f-]{36}$/);
    expect(res.headers['x-request-id']).not.toBe('untrusted');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' https://accounts.google.com/gsi/client",
    );
    expect(res.headers['content-security-policy']).toContain(
      "connect-src 'self' https://accounts.google.com/gsi/",
    );
    expect(res.headers['content-security-policy']).not.toContain('unsafe-eval');
    expect(res.headers['content-security-policy']).not.toContain(' *');
    expect(isDatabaseReady).not.toHaveBeenCalled();
  });
  it('readiness checks the database', async () => {
    const app = setup();
    const res = await request(app).get('/api/v1/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'connected' } });
    expect(isDatabaseReady).toHaveBeenCalledOnce();
  });
  it('unavailable database returns 503 with a correlated request ID', async () => {
    const res = await request(setup(false)).get('/api/v1/ready');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'NOT_READY',
      requestId: res.headers['x-request-id'],
    });
  });
  it('shutdown makes readiness fail without another database ping', async () => {
    const app = setup();
    app.locals.shuttingDown = true;
    expect((await request(app).get('/api/v1/ready')).status).toBe(503);
    expect(isDatabaseReady).not.toHaveBeenCalled();
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
  it('does not report ready if shutdown begins during the database ping', async () => {
    const app = setup();
    isDatabaseReady.mockImplementation(async () => {
      app.locals.shuttingDown = true;
      return true;
    });
    expect((await request(app).get('/api/v1/ready')).status).toBe(503);
  });
  it('unknown routes have a consistent 404 without echoing query secrets', async () => {
    const res = await request(setup()).get('/missing?token=secret-token');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-token');
  });
  it('serves the production frontend while preserving backend route boundaries', async () => {
    const frontendDistPath = await mkdtemp(path.join(os.tmpdir(), 'loadlab-frontend-'));
    temporaryDirectories.push(frontendDistPath);
    await mkdir(path.join(frontendDistPath, 'assets'));
    await writeFile(
      path.join(frontendDistPath, 'index.html'),
      '<!doctype html><html><body>LoadLab production shell</body></html>',
    );
    await writeFile(path.join(frontendDistPath, 'assets', 'app.js'), 'window.LOADLAB = true;');
    const app = createApp({ ...config, NODE_ENV: 'production' }, { frontendDistPath });

    for (const route of [
      '/',
      '/login',
      '/register',
      '/overview',
      '/plans',
      '/targets',
      '/history',
      '/compare',
      '/runs/run-id',
      '/runs/run-id/live',
    ]) {
      expect((await request(app).get(route)).text).toContain('LoadLab production shell');
    }
    expect((await request(app).get('/assets/app.js')).text).toContain('window.LOADLAB');
    expect((await request(app).get('/api/v1/health')).body.status).toBe('ok');
    const missingApi = await request(app).get('/api/v1/missing');
    expect(missingApi.body.error.code).toBe('AUTH_REQUIRED');
    expect(missingApi.text).not.toContain('LoadLab production shell');
    expect((await request(app).get('/socket.io/missing')).body.error.code).toBe('NOT_FOUND');
  });
  it('allows the configured frontend and exposes request IDs', async () => {
    const res = await request(setup()).get('/api/v1/health').set('Origin', config.CLIENT_URL);
    expect(res.headers['access-control-allow-origin']).toBe(config.CLIENT_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toBe('X-Request-ID');
    const preflight = await request(setup())
      .options('/api/v1/health')
      .set('Origin', config.CLIENT_URL)
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.status).toBe(204);
  });
  it('rejects another browser origin', async () => {
    const res = await request(setup())
      .get('/api/v1/health')
      .set('Origin', 'https://example.invalid');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('allows only the exact configured production origin and trusts one proxy hop', async () => {
    const productionOrigin = 'https://loadlab.example.com';
    const app = createApp({ ...config, NODE_ENV: 'production', CLIENT_URL: productionOrigin });
    expect(app.get('trust proxy')).toBe(1);
    const allowed = await request(app).get('/api/v1/health').set('Origin', productionOrigin);
    expect(allowed.headers['access-control-allow-origin']).toBe(productionOrigin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-allow-origin']).not.toBe('*');
    const rejected = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://unrelated.example.com');
    expect(rejected.status).toBe(403);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    expect(setup().get('trust proxy')).toBe(false);
  });
  it('rejects malformed JSON and oversized bodies', async () => {
    const app = setup();
    const invalid = await request(app)
      .post('/missing')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_JSON');
    const large = await request(app)
      .post('/missing')
      .send({ value: 'x'.repeat(33000) });
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('error middleware', () => {
  it.each(['production', 'development'])('sanitizes async failures in %s', async (environment) => {
    const app = express();
    app.set('env', environment);
    app.use(requestLogger);
    app.get('/failure', async () => {
      throw new TypeError('mongodb://user:secret@host/db');
    });
    app.use(errorHandler);
    const res = await request(app).get('/failure');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret');
    expect(res.body.error.diagnostics).toEqual(
      environment === 'development' ? { kind: 'TypeError' } : undefined,
    );
  });
  it('delegates when headers have already been sent', () => {
    const error = new Error('late failure');
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn() };
    errorHandler(error, { id: 'id' }, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Response could not be completed.' }),
    );
    expect(res.status).not.toHaveBeenCalled();
  });
});
