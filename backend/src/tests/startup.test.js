import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('the actual server entrypoint exits cleanly with invalid configuration before connecting', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../server.js', import.meta.url))],
    {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MONGODB_URI: '',
        CLIENT_URL: 'http://localhost:5173',
        PORT: '5000',
      },
      encoding: 'utf8',
      timeout: 5000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  const events = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'startup_failed',
        stage: 'configuration',
        message: 'Check the required environment variables.',
      }),
      expect.objectContaining({ event: 'shutdown_complete', exitCode: 1 }),
    ]),
  );
  expect(events.some((entry) => entry.event === 'server_started')).toBe(false);
  expect(result.stderr).toBe('');
});
