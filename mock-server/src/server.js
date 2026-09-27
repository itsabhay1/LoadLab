import { createServer } from 'node:http';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

export function createMockServer() {
  let flakyRequest = 0;

  return createServer((request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/fast') {
      sendJson(response, 200, { endpoint: 'fast' });
      return;
    }
    if (path === '/slow') {
      setTimeout(() => {
        if (!response.destroyed) sendJson(response, 200, { endpoint: 'slow', delayMs: 250 });
      }, 250);
      return;
    }
    if (path === '/variable') {
      const delayMs = 20 + Math.floor(Math.random() * 181);
      setTimeout(() => {
        if (!response.destroyed) sendJson(response, 200, { endpoint: 'variable', delayMs });
      }, delayMs);
      return;
    }
    if (path === '/flaky') {
      flakyRequest += 1;
      const failed = flakyRequest % 3 === 0;
      sendJson(response, failed ? 503 : 200, {
        endpoint: 'flaky',
        status: failed ? 'failed' : 'ok',
      });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  });
}

function parsePort(value) {
  const port = Number(value ?? 5050);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MOCK_SERVER_PORT must be an integer from 1 to 65535.');
  }
  return port;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.env.MOCK_SERVER_PORT);
  const server = createMockServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`LoadLab mock server listening at http://127.0.0.1:${port}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('error', (error) => {
    console.error(`Mock server failed: ${error.name}`);
    process.exit(1);
  });
}
