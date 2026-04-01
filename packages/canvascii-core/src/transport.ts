import { z } from 'zod'
import type { CanvasCommand } from './contracts'

export const CANVASCII_DEFAULTS = {
  appPort: 5001,
  collabPort: 5002,
  collabHealthPort: 5003,
  minioApiPort: 5005,
  minioConsolePort: 5006,
  s3Bucket: 'canvascii-dev',
  localSnapshotDir: './.canvascii-collab-data',
  localLibraryDir: './.canvascii-app-data',
} as const

export const canvasciiActorTypeSchema = z.enum(['human', 'agent', 'system'])
export type CanvasciiActorType = z.infer<typeof canvasciiActorTypeSchema>

export const canvasciiPrincipalSchema = z.object({
  userId: z.string(),
  actorId: z.string().optional(),
  actorType: canvasciiActorTypeSchema.optional(),
  sessionId: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  source: z.enum(['better-auth', 'share-link', 'agent-session', 'dev-bypass']),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type CanvasciiPrincipal = z.infer<typeof canvasciiPrincipalSchema>

export const canvasciiHealthSchema = z.object({
  status: z.enum(['ok']),
  service: z.literal('canvascii-collab'),
  authMode: z.enum(['better-auth', 'better-auth-with-dev-bypass']),
  documentsPersisted: z.number().int().nonnegative(),
  lastPersistedAt: z.string().nullable(),
  localSnapshotDir: z.string(),
  s3Enabled: z.boolean(),
  s3Bucket: z.string().nullable(),
})

export type CanvasciiCollabHealth = z.infer<typeof canvasciiHealthSchema>

export const CANVASCII_STATELESS_COMMAND_REQUEST_KIND = 'canvas.command.request' as const
export const CANVASCII_STATELESS_COMMAND_RESULT_KIND = 'canvas.command.result' as const

export const canvasciiStatelessCommandRequestSchema = z.object({
  kind: z.literal(CANVASCII_STATELESS_COMMAND_REQUEST_KIND),
  requestId: z.string().min(1),
  actorId: z.string().nullable().optional(),
  expectedDocumentVersion: z.number().int().nonnegative().optional(),
  commands: z.array(z.custom<CanvasCommand>()).min(1),
})

export type CanvasciiStatelessCommandRequest = z.infer<typeof canvasciiStatelessCommandRequestSchema>

export const canvasciiStatelessCommandResultSchema = z.object({
  kind: z.literal(CANVASCII_STATELESS_COMMAND_RESULT_KIND),
  requestId: z.string().min(1),
  status: z.enum(['applied', 'rejected', 'error']),
  documentVersion: z.number().int().nonnegative().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  commandIds: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
  rejectedCommandIds: z.array(z.string()).optional(),
})

export type CanvasciiStatelessCommandResult = z.infer<typeof canvasciiStatelessCommandResultSchema>

export function toCanvasciiStorageBasename(documentName: string): string {
  return encodeURIComponent(documentName).replace(/%/g, '_')
}

export function toCanvasciiSnapshotObjectKey(documentName: string): string {
  return `documents/${toCanvasciiStorageBasename(documentName)}.bin`
}
