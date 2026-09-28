import { z } from 'zod';

const duration = z.string().regex(/^\d+[smhd]$/);

const schema = z
  .object({
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
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: duration.default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRES_IN: duration.default('7d'),
    GOOGLE_CLIENT_ID: z.string().trim().default(''),
    MOCK_SERVER_URL: z
      .url()
      .default('http://127.0.0.1:5050')
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
            url.origin === value
          );
        } catch {
          return false;
        }
      }),
  })
  .superRefine((value, context) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Refresh and access secrets must be different.',
      });
    }
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
