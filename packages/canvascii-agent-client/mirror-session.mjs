import { CanvasciiAgentClient } from './index.mjs'

function trimOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseRect(value) {
  const parts = String(value ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null
  }
  return {
    top: parts[0],
    left: parts[1],
    width: parts[2],
    height: parts[3],
  }
}

function pointWithinRect(point, rect) {
  return (
    point.row >= rect.top &&
    point.row < rect.top + rect.height &&
    point.col >= rect.left &&
    point.col < rect.left + rect.width
  )
}

function rectangleFromObject(object) {
  if (object?.geometry?.type !== 'rectangle') return null
  return {
    top: Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row),
    left: Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col),
    width: Math.abs(object.geometry.bottomRight.col - object.geometry.topLeft.col) + 1,
    height: Math.abs(object.geometry.bottomRight.row - object.geometry.topLeft.row) + 1,
  }
}

function objectPoints(object) {
  switch (object.geometry.type) {
    case 'rectangle': {
      const rect = rectangleFromObject(object)
      return Array.from({ length: rect.height }, (_, rowIndex) =>
        Array.from({ length: rect.width }, (_, colIndex) => ({
          row: rect.top + rowIndex,
          col: rect.left + colIndex,
        })),
      ).flat()
    }
    case 'text':
      return object.geometry.lines.flatMap((line, rowIndex) =>
        Array.from({ length: Math.max(1, Array.from(line).length) }, (_, colIndex) => ({
          row: object.geometry.start.row + rowIndex,
          col: object.geometry.start.col + colIndex,
        })),
      )
    case 'line': {
      const { segment } = object.geometry
      if (segment.axis === 'horizontal') {
        const start = Math.min(segment.start.col, segment.end.col)
        const end = Math.max(segment.start.col, segment.end.col)
        return Array.from({ length: end - start + 1 }, (_, index) => ({
          row: segment.start.row,
          col: start + index,
        }))
      }
      const start = Math.min(segment.start.row, segment.end.row)
      const end = Math.max(segment.start.row, segment.end.row)
      return Array.from({ length: end - start + 1 }, (_, index) => ({
        row: start + index,
        col: segment.start.col,
      }))
    }
    case 'polyline':
      return object.geometry.segments.flatMap((segment) => objectPoints({ geometry: { type: 'line', segment } }))
    case 'group':
      return []
    default:
      return []
  }
}

function isObjectInsideRect(object, rect) {
  const points = objectPoints(object)
  return points.length > 0 && points.every((point) => pointWithinRect(point, rect))
}

function cursorWithinRegion(cursor, canvasId, rect) {
  return Boolean(
    cursor &&
      cursor.canvasId === canvasId &&
      pointWithinRect({ row: cursor.row, col: cursor.col }, rect),
  )
}

function scalePortalCoordinate(offset, sourceSize, targetStart, targetSize) {
  if (sourceSize <= 1 || targetSize <= 1) return targetStart
  return targetStart + Math.round((offset / (sourceSize - 1)) * (targetSize - 1))
}

function mapPoint(point, sourceRect, targetRect) {
  return {
    row: scalePortalCoordinate(point.row - sourceRect.top, sourceRect.height, targetRect.top, targetRect.height),
    col: scalePortalCoordinate(point.col - sourceRect.left, sourceRect.width, targetRect.left, targetRect.width),
  }
}

function mapSegment(segment, sourceRect, targetRect) {
  return {
    ...segment,
    start: mapPoint(segment.start, sourceRect, targetRect),
    end: mapPoint(segment.end, sourceRect, targetRect),
  }
}

function mapDraftShape(shape, sourceRect, targetRect) {
  if (!shape || typeof shape !== 'object') return null

  switch (shape.type) {
    case 'RECTANGLE':
      return {
        ...shape,
        tl: mapDraftCoords(shape.tl, sourceRect, targetRect),
        br: mapDraftCoords(shape.br, sourceRect, targetRect),
      }
    case 'LINE':
      return {
        ...shape,
        start: mapDraftCoords(shape.start, sourceRect, targetRect),
        end: mapDraftCoords(shape.end, sourceRect, targetRect),
      }
    case 'MULTI_SEGMENT_LINE':
      return {
        ...shape,
        segments: Array.isArray(shape.segments)
          ? shape.segments.map((segment) => ({
              ...segment,
              start: mapDraftCoords(segment.start, sourceRect, targetRect),
              end: mapDraftCoords(segment.end, sourceRect, targetRect),
            }))
          : [],
      }
    case 'TEXT':
      return {
        ...shape,
        start: mapDraftCoords(shape.start, sourceRect, targetRect),
      }
    default:
      return shape
  }
}

function mapDraftCoords(coords, sourceRect, targetRect) {
  if (!coords || typeof coords !== 'object') return coords
  const mapped = mapPoint({ row: coords.r, col: coords.c }, sourceRect, targetRect)
  return {
    ...coords,
    r: mapped.row,
    c: mapped.col,
  }
}

function mapDraft(draft, targetCanvasId, sourceRect, targetRect) {
  if (!draft) return null

  if (draft.kind === 'portal') {
    const topLeft = mapPoint(
      { row: draft.rect.top, col: draft.rect.left },
      sourceRect,
      targetRect,
    )
    const bottomRight = mapPoint(
      { row: draft.rect.top + draft.rect.height - 1, col: draft.rect.left + draft.rect.width - 1 },
      sourceRect,
      targetRect,
    )

    return {
      kind: 'portal',
      canvasId: targetCanvasId,
      rect: {
        top: Math.min(topLeft.row, bottomRight.row),
        left: Math.min(topLeft.col, bottomRight.col),
        width: Math.abs(bottomRight.col - topLeft.col) + 1,
        height: Math.abs(bottomRight.row - topLeft.row) + 1,
      },
    }
  }

  if (draft.kind === 'shape') {
    return {
      ...draft,
      canvasId: targetCanvasId,
      shape: mapDraftShape(draft.shape, sourceRect, targetRect),
    }
  }

  if (draft.kind === 'objects') {
    return {
      ...draft,
      canvasId: targetCanvasId,
      objects: Array.isArray(draft.objects)
        ? draft.objects.map((object) => ({
            ...object,
            shape: mapDraftShape(object.shape, sourceRect, targetRect),
          }))
        : [],
    }
  }

  return null
}

function mapObject(object, sourceRect, targetRect, input = {}) {
  const mirroredId = `mirror:${input.sessionId}:${object.id}`
  const previousMirroredObject = input.existingObjects?.find((entry) => entry.id === mirroredId) ?? null
  const createdAt = previousMirroredObject?.createdAt ?? object.createdAt ?? new Date().toISOString()
  const updatedAt = new Date().toISOString()
  const version = (previousMirroredObject?.version ?? 0) + 1

  const geometry = (() => {
    switch (object.geometry.type) {
      case 'rectangle':
        return {
          ...object.geometry,
          topLeft: mapPoint(object.geometry.topLeft, sourceRect, targetRect),
          bottomRight: mapPoint(object.geometry.bottomRight, sourceRect, targetRect),
        }
      case 'text':
        return {
          ...object.geometry,
          start: mapPoint(object.geometry.start, sourceRect, targetRect),
        }
      case 'line':
        return {
          ...object.geometry,
          segment: mapSegment(object.geometry.segment, sourceRect, targetRect),
        }
      case 'polyline':
        return {
          ...object.geometry,
          segments: object.geometry.segments.map((segment) => mapSegment(segment, sourceRect, targetRect)),
        }
      case 'group':
        return object.geometry
      default:
        return object.geometry
    }
  })()

  return {
    ...object,
    id: mirroredId,
    canvasId: input.targetCanvasId ?? object.canvasId,
    regionId: `${input.targetCanvasId ?? object.canvasId}:root-region`,
    geometry,
    createdAt,
    updatedAt,
    version,
    metadata: {
      ...(object.metadata ?? {}),
      regionMirror: {
        sessionId: input.sessionId,
        sourceObjectId: object.id,
      },
    },
  }
}

function createCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cmd:${crypto.randomUUID()}`
  }

  return `cmd:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function resolveMarkerBox(document, label) {
  const marker = document.objects.find(
    (object) =>
      object.geometry.type === 'text' &&
      object.geometry.lines.length === 1 &&
      object.geometry.lines[0]?.trim() === label,
  )
  if (!marker || marker.geometry.type !== 'text') return null

  const containingRects = document.objects
    .filter((object) => object.geometry.type === 'rectangle')
    .filter((object) => !isMirroredObject(object))
    .map((object) => ({ object, rect: rectangleFromObject(object) }))
    .filter((entry) => entry.rect && pointWithinRect(marker.geometry.start, entry.rect))
    .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height)

  const container = containingRects[0]?.object ?? null
  const rect = containingRects[0]?.rect ?? null
  if (!container || !rect) return null

  return {
    canvasId: marker.canvasId,
    rect,
    markerId: marker.id,
    containerId: container.id,
  }
}

function stableSignature(value) {
  return JSON.stringify(value)
}

function isMirroredObject(object) {
  return Boolean(
    object &&
      (String(object.id ?? '').startsWith('mirror:') ||
        object.metadata?.regionMirror ||
        object.metadata?.mirror),
  )
}

function resolveSourcePresence(collaborators, config) {
  const preferredActorId = trimOrNull(process.env.CANVASCII_MIRROR_SOURCE_ACTOR_ID)
  const preferredSessionId = trimOrNull(process.env.CANVASCII_MIRROR_SOURCE_SESSION_ID)
  const preferredName = trimOrNull(process.env.CANVASCII_MIRROR_SOURCE_NAME)?.toLowerCase() ?? null

  const candidates = collaborators.filter((collaborator) => {
    if (!collaborator || collaborator.actorId === client.actorId) return false
    if (preferredActorId && collaborator.actorId !== preferredActorId) return false
    if (preferredSessionId && collaborator.sessionId !== preferredSessionId) return false
    if (preferredName && String(collaborator.name ?? '').trim().toLowerCase() !== preferredName) return false
    return cursorWithinRegion(collaborator.cursor, config.sourceCanvasId, config.sourceRect)
  })

  return (
    candidates.find((collaborator) => collaborator.actorType === 'human') ??
    candidates.find((collaborator) => collaborator.actorType === 'agent') ??
    null
  )
}

function resolveMirrorConfig(document) {
  const sourceRect = parseRect(process.env.CANVASCII_MIRROR_SOURCE_RECT)
  const targetRect = parseRect(process.env.CANVASCII_MIRROR_TARGET_RECT)
  const sourceCanvasId = trimOrNull(process.env.CANVASCII_MIRROR_SOURCE_CANVAS_ID) || document.activeCanvasId
  const targetCanvasId = trimOrNull(process.env.CANVASCII_MIRROR_TARGET_CANVAS_ID) || document.activeCanvasId
  const sourceMarker = trimOrNull(process.env.CANVASCII_MIRROR_SOURCE_TEXT)
  const targetMarker = trimOrNull(process.env.CANVASCII_MIRROR_TARGET_TEXT)

  if (sourceRect && targetRect) {
    return {
      sourceRect,
      targetRect,
      sourceCanvasId,
      targetCanvasId,
      ignoredObjectIds: new Set(),
    }
  }

  if (sourceMarker && targetMarker) {
    const sourceBox = resolveMarkerBox(document, sourceMarker)
    const targetBox = resolveMarkerBox(document, targetMarker)
    if (!sourceBox || !targetBox) {
      throw new Error(`Could not resolve marker boxes for "${sourceMarker}" and "${targetMarker}".`)
    }
    return {
      sourceRect: sourceBox.rect,
      targetRect: targetBox.rect,
      sourceCanvasId: sourceBox.canvasId,
      targetCanvasId: targetBox.canvasId,
      ignoredObjectIds: new Set([sourceBox.markerId, sourceBox.containerId, targetBox.markerId, targetBox.containerId]),
    }
  }

  throw new Error('Provide CANVASCII_MIRROR_SOURCE_RECT + CANVASCII_MIRROR_TARGET_RECT, or CANVASCII_MIRROR_SOURCE_TEXT + CANVASCII_MIRROR_TARGET_TEXT.')
}

const shareUrl = trimOrNull(process.env.CANVASCII_SHARE_URL)
if (!shareUrl) {
  throw new Error('CANVASCII_SHARE_URL is required.')
}

const client = CanvasciiAgentClient.fromShareUrl(shareUrl, {
  name: trimOrNull(process.env.CANVASCII_MIRROR_NAME) || 'Canvascii Mirror Agent',
  actorId: trimOrNull(process.env.CANVASCII_MIRROR_ACTOR_ID) || 'agent:canvascii-mirror',
  color: trimOrNull(process.env.CANVASCII_MIRROR_COLOR) || '#f97316',
})

await client.connect()

let lastSourceSignature = null
let lastPresenceSignature = null
const mirrorSessionId = trimOrNull(process.env.CANVASCII_MIRROR_SESSION_ID) || `mirror-${Date.now()}`

async function syncMirror(document) {
  const config = resolveMirrorConfig(document)
  const sourceObjects = document.objects
    .filter((object) => object.canvasId === config.sourceCanvasId)
    .filter((object) => !isMirroredObject(object))
    .filter((object) => !config.ignoredObjectIds.has(object.id))
    .filter((object) => isObjectInsideRect(object, config.sourceRect))
    .sort((left, right) => left.zIndex - right.zIndex)

  const signature = stableSignature(
    sourceObjects.map((object) => ({
      id: object.id,
      type: object.type,
      geometry: object.geometry,
      style: object.style,
      content: object.content,
      zIndex: object.zIndex,
      locked: object.locked,
    })),
  )
  if (signature === lastSourceSignature) {
    return
  }
  lastSourceSignature = signature

  const existingMirroredObjects = document.objects.filter((object) =>
    String(object.id ?? '').startsWith(`mirror:${mirrorSessionId}:`) ||
    object.metadata?.regionMirror?.sessionId === mirrorSessionId,
  )
  const nextMirroredObjects = sourceObjects.map((object) =>
    mapObject(object, config.sourceRect, config.targetRect, {
      targetCanvasId: config.targetCanvasId,
      sessionId: mirrorSessionId,
      existingObjects: existingMirroredObjects,
    }),
  )
  const nextMirroredIds = new Set(nextMirroredObjects.map((object) => object.id))
  const commands = [
    ...existingMirroredObjects
      .filter((object) => !nextMirroredIds.has(object.id))
      .map((object) => ({
        id: createCommandId(),
        type: 'object.delete',
        actorId: client.actorId,
        at: new Date().toISOString(),
        input: {
          objectId: object.id,
        },
      })),
    ...nextMirroredObjects.map((object) => ({
      id: createCommandId(),
      type: 'object.upsert',
      actorId: client.actorId,
      at: new Date().toISOString(),
      input: {
        object,
      },
    })),
  ]

  if (commands.length === 0) {
    return
  }

  await client.submitCommands(commands, {
    timeoutMs: 15_000,
  })
}

function syncPresence(document, collaborators) {
  const config = resolveMirrorConfig(document)
  const sourcePresence = resolveSourcePresence(collaborators, config)

  if (!sourcePresence?.cursor) {
    const signature = stableSignature({ status: 'waiting' })
    if (signature === lastPresenceSignature) {
      return
    }
    lastPresenceSignature = signature
    client.publishPresence({
      activeTool: null,
      status: 'waiting',
      intent: 'watching source region',
      cursor: {
        canvasId: config.targetCanvasId,
        row: config.targetRect.top,
        col: config.targetRect.left,
      },
    })
    return
  }

  const mirroredCursor = mapPoint(
    { row: sourcePresence.cursor.row, col: sourcePresence.cursor.col },
    config.sourceRect,
    config.targetRect,
  )
  const signature = stableSignature({
    actorId: sourcePresence.actorId,
    sessionId: sourcePresence.sessionId,
    activeTool: sourcePresence.activeTool ?? null,
    status: sourcePresence.status ?? null,
    cursor: mirroredCursor,
    draft: sourcePresence.draft ?? null,
  })

  if (signature === lastPresenceSignature) {
    return
  }
  lastPresenceSignature = signature

  client.publishPresence({
    activeTool: sourcePresence.activeTool ?? 'SELECT',
    status: sourcePresence.status ?? 'mirroring',
    intent: `mirroring ${sourcePresence.name ?? 'collaborator'}`,
    cursor: {
      canvasId: config.targetCanvasId,
      row: mirroredCursor.row,
      col: mirroredCursor.col,
    },
    draft: mapDraft(sourcePresence.draft, config.targetCanvasId, config.sourceRect, config.targetRect),
  })
}

const initialDocument = client.getDocument()
await syncMirror(initialDocument)
syncPresence(initialDocument, client.listCollaborators())
const stopObserving = client.observeDocument((document) => {
  void syncMirror(document)
})
const stopObservingCollaborators = client.observeCollaborators((collaborators) => {
  syncPresence(client.getDocument(), collaborators)
})

console.log(
  JSON.stringify(
    {
      status: 'running',
      mode: 'live-region-mirror',
      shareUrl,
      sourceMarker: trimOrNull(process.env.CANVASCII_MIRROR_SOURCE_TEXT),
      targetMarker: trimOrNull(process.env.CANVASCII_MIRROR_TARGET_TEXT),
    },
    null,
    2,
  ),
)

const shutdown = () => {
  stopObserving()
  stopObservingCollaborators()
  client.disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await new Promise(() => {})
