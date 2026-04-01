import {
  CANVASCII_YDOC_DOCUMENT_KEY,
  CANVASCII_YDOC_ROOT_KEY,
  createCanvasCommandsForTransition,
  filterCanvasCommandsByAccess,
  type CanvasAccessSummary,
  type CanvasDocument,
} from '@canvascii/core'
import * as decoding from 'lib0/decoding.js'
import { messageYjsSyncStep2, messageYjsUpdate } from 'y-protocols/sync.js'
import * as Y from 'yjs'

const MESSAGE_TYPE_SYNC = 0
const MESSAGE_TYPE_SYNC_REPLY = 4

function cloneDocumentState(document: Y.Doc) {
  const clone = new Y.Doc()
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document))
  return clone
}

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

function getCanvasDocumentState(document: Y.Doc): CanvasDocument | null {
  const root = document.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
  const candidate = root.get(CANVASCII_YDOC_DOCUMENT_KEY)
  return isCanvasDocument(candidate) ? candidate : null
}

function readIncomingSyncUpdate(message: Uint8Array): Uint8Array | null {
  const decoder = decoding.createDecoder(message)
  decoding.readVarString(decoder)
  const messageType = decoding.readVarUint(decoder)

  if (messageType !== MESSAGE_TYPE_SYNC && messageType !== MESSAGE_TYPE_SYNC_REPLY) {
    return null
  }

  const syncType = decoding.readVarUint(decoder)
  if (syncType !== messageYjsSyncStep2 && syncType !== messageYjsUpdate) {
    return null
  }

  return decoding.readVarUint8Array(decoder)
}

export function authorizeDocumentUpdate(input: {
  document: Y.Doc
  access: CanvasAccessSummary | null | undefined
  update: Uint8Array
}) {
  const incomingUpdate = readIncomingSyncUpdate(input.update)
  if (!incomingUpdate || !input.access) {
    return {
      allowed: true,
      reason: null,
    }
  }

  const previousDocument = getCanvasDocumentState(input.document)
  if (!previousDocument) {
    return {
      allowed: true,
      reason: null,
    }
  }

  const clone = cloneDocumentState(input.document)
  Y.applyUpdate(clone, incomingUpdate)
  const nextDocument = getCanvasDocumentState(clone)
  if (!nextDocument) {
    return {
      allowed: false,
      reason: 'Canonical document payload is missing after the proposed update.',
      commands: [],
      rejectedCommands: [],
    }
  }

  const commands = createCanvasCommandsForTransition({
    previousDocument,
    nextDocument,
    actorId: null,
    at: nextDocument.updatedAt,
  })
  const authorization = filterCanvasCommandsByAccess({
    access: input.access,
    previousDocument,
    commands,
  })

  return {
    allowed: authorization.rejectedCommands.length === 0,
    reason:
      authorization.rejectedCommands.length > 0
        ? 'Canvas update is outside the areas this collaborator can edit.'
        : null,
    commands,
    rejectedCommands: authorization.rejectedCommands,
  }
}
