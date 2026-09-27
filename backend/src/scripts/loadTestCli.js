import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { LOAD_LIMITS, runLoadTest } from '../services/loadEngine.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function integerOption(name, fallback) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer.`);
  return value;
}

async function main() {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
  const mockServerOrigin = process.env.MOCK_SERVER_URL ?? 'http://127.0.0.1:5050';
  const endpoint = option('endpoint', '/fast');
  const virtualUsers = integerOption('vus', 10);
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());

  const result = await runLoadTest({
    mockServerOrigin,
    targetUrl: new URL(endpoint, mockServerOrigin).href,
    virtualUsers,
    durationMs: integerOption('duration', 5) * 1000,
    rampUpMs: integerOption('ramp-up', 1) * 1000,
    requestTimeoutMs: integerOption('timeout', 2000),
    requestsPerSecond: integerOption('rps', 1000),
    maxConnections: integerOption(
      'connections',
      Math.min(virtualUsers, LOAD_LIMITS.maxConnections),
    ),
    signal: controller.signal,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
