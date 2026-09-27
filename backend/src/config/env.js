import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z
    .string()
    .trim()
    .min(1)
    .regex(/^mongodb(?:\+srv)?:\/\/[^\s]+$/),
  CLIENT_URL: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }),
});

export function parseEnv(input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Report field names only: validation inputs and URI values may contain credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return Object.freeze(result.data);
}
