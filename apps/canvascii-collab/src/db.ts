import { createCanvasciiPostgresConfig } from '@canvascii/core'
import { Pool } from 'pg'
import { collabConfig } from './config'

declare global {
  // eslint-disable-next-line no-var
  var __canvasciiCollabPgPool: Pool | undefined
}

export const canvasciiCollabPgPool =
  globalThis.__canvasciiCollabPgPool ??
  new Pool(createCanvasciiPostgresConfig(collabConfig.databaseUrl))

if (process.env.NODE_ENV !== 'production') {
  globalThis.__canvasciiCollabPgPool = canvasciiCollabPgPool
}
