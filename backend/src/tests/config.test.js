import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';

const valid = {
  MONGODB_URI: 'mongodb://localhost:27017/loadlab',
  CLIENT_URL: 'http://localhost:5173',
};
describe('environment validation', () => {
  it('parses defaults and a valid Atlas URI', () => {
    expect(parseEnv(valid)).toMatchObject({ PORT: 5000, NODE_ENV: 'development' });
    expect(
      parseEnv({
        ...valid,
        MONGODB_URI: 'mongodb+srv://user:password@cluster.example/loadlab',
        PORT: '5010',
      }).PORT,
    ).toBe(5010);
  });
  it.each([
    { MONGODB_URI: '' },
    { MONGODB_URI: 'https://user:secret@host' },
    { PORT: 'zero' },
    { PORT: '0' },
    { PORT: '65536' },
    { NODE_ENV: 'staging' },
    { CLIENT_URL: '*' },
    { CLIENT_URL: 'http://localhost:5173/path' },
    { CLIENT_URL: 'http://localhost:5173/' },
    { CLIENT_URL: 'ftp://localhost' },
    { CLIENT_URL: 'http://user:secret@localhost:5173' },
  ])('rejects invalid config %j without including values', (override) => {
    expect(() => parseEnv({ ...valid, ...override })).toThrow(/Invalid environment configuration/);
    try {
      parseEnv({ ...valid, ...override });
    } catch (error) {
      expect(error.message).not.toContain('secret');
    }
  });
  it('requires database URI and client origin', () => {
    expect(() => parseEnv({})).toThrow('MONGODB_URI, CLIENT_URL');
  });
});
