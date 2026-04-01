import { createCanvasciiPostgresConfig } from '@canvascii/core'
import { Pool } from 'pg'
import { canvasciiServerEnv } from './env'

declare global {
  // eslint-disable-next-line no-var
  var __canvasciiPgPool: Pool | undefined
}

export const canvasciiPgPool =
  globalThis.__canvasciiPgPool ??
  new Pool(createCanvasciiPostgresConfig(canvasciiServerEnv.DATABASE_URL))

if (process.env.NODE_ENV !== 'production') {
  globalThis.__canvasciiPgPool = canvasciiPgPool
}
