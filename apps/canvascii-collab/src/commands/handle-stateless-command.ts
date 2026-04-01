import {
  applyCanvasCommands,
  CANVASCII_STATELESS_COMMAND_REQUEST_KIND,
  CANVASCII_STATELESS_COMMAND_RESULT_KIND,
  CANVASCII_YDOC_DOCUMENT_KEY,
  CANVASCII_YDOC_ROOT_KEY,
  canvasciiStatelessCommandRequestSchema,
  filterCanvasCommandsByAccess,
  type CanvasAccessSummary,
  type CanvasDocument,
  type CanvasciiPrincipal,
} from '@canvascii/core'
import type { onStatelessPayload } from '@hocuspocus/server'

function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as CanvasDocument
  return (
    typeof candidate.id === 'string' &&
    Array.isArray(candidate.canvases) &&
    Array.isArray(candidate.regions) &&
    Array.isArray(candidate.objects)
  )
}

function getCanvasDocumentState(document: onStatelessPayload['document']): CanvasDocument | null {
  const root = document.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
  const candidate = root.get(CANVASCII_YDOC_DOCUMENT_KEY)
  return isCanvasDocument(candidate) ? candidate : null
}

function sendResult(
  connection: onStatelessPayload['connection'],
  result: {
    requestId: string
    status: 'applied' | 'rejected' | 'error'
    documentVersion?: number | null
    updatedAt?: string | null
    commandIds?: string[]
    rejectedCommandIds?: string[]
    error?: string | null
  },
) {
  connection.sendStateless(
    JSON.stringify({
      kind: CANVASCII_STATELESS_COMMAND_RESULT_KIND,
      requestId: result.requestId,
      status: result.status,
      documentVersion: result.documentVersion ?? null,
      updatedAt: result.updatedAt ?? null,
      ...(result.commandIds ? { commandIds: result.commandIds } : {}),
      ...(result.rejectedCommandIds ? { rejectedCommandIds: result.rejectedCommandIds } : {}),
      ...(result.error ? { error: result.error } : {}),
    }),
  )
}

export async function handleStatelessCommand(input: {
  payload: onStatelessPayload
  onApplied?: (documentName: string, document: onStatelessPayload['document']) => void
}) {
  let parsedPayload: unknown
  try {
    parsedPayload = JSON.parse(input.payload.payload)
  } catch {
    return
  }

  if (!parsedPayload || typeof parsedPayload !== 'object') {
    return
  }

  const candidateKind =
    'kind' in parsedPayload && typeof parsedPayload.kind === 'string'
      ? parsedPayload.kind
      : null
  if (candidateKind !== CANVASCII_STATELESS_COMMAND_REQUEST_KIND) {
    return
  }

  const request = canvasciiStatelessCommandRequestSchema.parse(parsedPayload)
  const access = (input.payload.connection.context as { access?: CanvasAccessSummary | null } | null)?.access ?? null
  const principal = (input.payload.connection.context as { principal?: CanvasciiPrincipal | null } | null)?.principal ?? null

  const previousDocument = getCanvasDocumentState(input.payload.document)
  if (!previousDocument) {
    sendResult(input.payload.connection, {
      requestId: request.requestId,
      status: 'error',
      error: 'Room document is missing.',
    })
    return
  }

  if (
    Number.isInteger(request.expectedDocumentVersion) &&
    (previousDocument.version ?? 0) !== request.expectedDocumentVersion
  ) {
    sendResult(input.payload.connection, {
      requestId: request.requestId,
      status: 'rejected',
      documentVersion: previousDocument.version ?? 0,
      error: `Revision mismatch. Expected ${request.expectedDocumentVersion}, got ${previousDocument.version ?? 0}. Re-read before mutating.`,
    })
    return
  }

  const commands = request.commands.map((command) => ({
    ...command,
    actorId: request.actorId ?? principal?.actorId ?? command.actorId ?? null,
  }))

  if (access) {
    const authorization = filterCanvasCommandsByAccess({
      access,
      previousDocument,
      commands,
    })
    if (authorization.rejectedCommands.length > 0) {
      sendResult(input.payload.connection, {
        requestId: request.requestId,
        status: 'rejected',
        error: 'Canvas command is outside the areas this collaborator can edit.',
        rejectedCommandIds: authorization.rejectedCommands.map((command) => command.id),
      })
      return
    }
  }

  try {
    const applied = applyCanvasCommands(previousDocument, commands)
    const root = input.payload.document.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
    root.set(CANVASCII_YDOC_DOCUMENT_KEY, applied.document)
    input.onApplied?.(input.payload.documentName, input.payload.document)
    sendResult(input.payload.connection, {
      requestId: request.requestId,
      status: 'applied',
      documentVersion: applied.document.version,
      updatedAt: applied.document.updatedAt,
      commandIds: commands.map((command) => command.id),
    })
  } catch (error) {
    sendResult(input.payload.connection, {
      requestId: request.requestId,
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to apply canvas commands.',
    })
  }
}
