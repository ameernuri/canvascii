import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://user:password@127.0.0.1:5004/canvascii'),
  BETTER_AUTH_SECRET: z.string().min(32).default('canvascii-local-dev-secret-2026-change-me'),
  BETTER_AUTH_URL: z.string().url().default('http://127.0.0.1:5001'),
  BETTER_AUTH_COOKIE_PREFIX: z.string().default('canvascii-auth'),
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .default('http://localhost:5001,http://127.0.0.1:5001')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
})

export const canvasciiServerEnv = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  BETTER_AUTH_COOKIE_PREFIX: process.env.BETTER_AUTH_COOKIE_PREFIX,
  BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
})
