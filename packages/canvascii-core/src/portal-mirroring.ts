import type { CanvasCommand, CanvasDocument, CanvasObject, CanvasPoint, CanvasSegment } from './contracts'
import { getCanvasObjectPoints } from './sharing'
import type { CanvasPortal } from './sharing'

function createCommandId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `cmd:${randomPart}`
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function pointWithinPortal(point: CanvasPoint, portal: CanvasPortal): boolean {
  return (
    point.row >= portal.rect.top &&
    point.row < portal.rect.top + portal.rect.height &&
    point.col >= portal.rect.left &&
    point.col < portal.rect.left + portal.rect.width
  )
}

function scalePortalCoordinate(offset: number, sourceSize: number, targetStart: number, targetSize: number) {
  if (sourceSize <= 1 || targetSize <= 1) {
    return targetStart
  }

  const ratio = offset / (sourceSize - 1)
  return targetStart + Math.round(ratio * (targetSize - 1))
}

export function normalizePortalLabel(label: string | null | undefined) {
  return label?.trim().toLowerCase() ?? ''
}

export function findPortalByLabel(
  portals: CanvasPortal[],
  label: string,
  canvasId?: string | null,
) {
  const normalizedTarget = normalizePortalLabel(label)
  return (
    portals.find(
      (portal) =>
        normalizePortalLabel(portal.label) === normalizedTarget &&
        (!canvasId || portal.canvasId === canvasId),
    ) ?? null
  )
}

export function isObjectFullyWithinPortal(object: CanvasObject, portal: CanvasPortal) {
  if (object.canvasId !== portal.canvasId) return false
  const points = getCanvasObjectPoints(object)
  return points.length > 0 && points.every((point) => pointWithinPortal(point, portal))
}

export function mapPointAcrossPortals(
  point: CanvasPoint,
  sourcePortal: CanvasPortal,
  targetPortal: CanvasPortal,
): CanvasPoint {
  return {
    row: scalePortalCoordinate(
      point.row - sourcePortal.rect.top,
      sourcePortal.rect.height,
      targetPortal.rect.top,
      targetPortal.rect.height,
    ),
    col: scalePortalCoordinate(
      point.col - sourcePortal.rect.left,
      sourcePortal.rect.width,
      targetPortal.rect.left,
      targetPortal.rect.width,
    ),
  }
}

function mapSegmentAcrossPortals(
  segment: CanvasSegment,
  sourcePortal: CanvasPortal,
  targetPortal: CanvasPortal,
): CanvasSegment {
  return {
    ...segment,
    start: mapPointAcrossPortals(segment.start, sourcePortal, targetPortal),
    end: mapPointAcrossPortals(segment.end, sourcePortal, targetPortal),
  }
}

export function createMirroredObjectId(sourceObjectId: string, targetPortalId: string) {
  return `mirror:${targetPortalId}:${sourceObjectId}`
}

function withMirrorMetadata(input: {
  object: CanvasObject
  sourceObjectId: string
  sourcePortal: CanvasPortal
  targetPortal: CanvasPortal
  previousMirroredObject?: CanvasObject | null
  at: string
}) {
  const createdAt = input.previousMirroredObject?.createdAt ?? input.object.createdAt ?? input.at
  const version = (input.previousMirroredObject?.version ?? 0) + 1

  return {
    ...input.object,
    id: createMirroredObjectId(input.sourceObjectId, input.targetPortal.id),
    canvasId: input.targetPortal.canvasId,
    regionId: `${input.targetPortal.canvasId}:root-region`,
    createdAt,
    updatedAt: input.at,
    version,
    metadata: {
      ...(input.object.metadata ?? {}),
      mirror: {
        sourceObjectId: input.sourceObjectId,
        sourcePortalId: input.sourcePortal.id,
        targetPortalId: input.targetPortal.id,
      },
    },
  } satisfies CanvasObject
}

export function mirrorObjectAcrossPortals(input: {
  object: CanvasObject
  sourcePortal: CanvasPortal
  targetPortal: CanvasPortal
  previousMirroredObject?: CanvasObject | null
  at?: string
}) {
  const at = input.at ?? new Date().toISOString()

  const baseObject = (() => {
    switch (input.object.geometry.type) {
      case 'rectangle':
        return {
          ...input.object,
          geometry: {
            ...input.object.geometry,
            topLeft: mapPointAcrossPortals(input.object.geometry.topLeft, input.sourcePortal, input.targetPortal),
            bottomRight: mapPointAcrossPortals(input.object.geometry.bottomRight, input.sourcePortal, input.targetPortal),
          },
        }
      case 'text':
        return {
          ...input.object,
          geometry: {
            ...input.object.geometry,
            start: mapPointAcrossPortals(input.object.geometry.start, input.sourcePortal, input.targetPortal),
          },
        }
      case 'line':
        return {
          ...input.object,
          geometry: {
            ...input.object.geometry,
            segment: mapSegmentAcrossPortals(input.object.geometry.segment, input.sourcePortal, input.targetPortal),
          },
        }
      case 'polyline':
        return {
          ...input.object,
          geometry: {
            ...input.object.geometry,
            segments: input.object.geometry.segments.map((segment) =>
              mapSegmentAcrossPortals(segment, input.sourcePortal, input.targetPortal),
            ),
          },
        }
      case 'group':
        return {
          ...input.object,
        }
    }
  })()

  return withMirrorMetadata({
    object: baseObject,
    sourceObjectId: input.object.id,
    sourcePortal: input.sourcePortal,
    targetPortal: input.targetPortal,
    previousMirroredObject: input.previousMirroredObject,
    at,
  })
}

function isMirroredObjectId(objectId: string | null | undefined) {
  return typeof objectId === 'string' && objectId.startsWith('mirror:')
}

function isMirroredObject(object: CanvasObject | null | undefined) {
  return Boolean(
    isMirroredObjectId(object?.id) ||
    (object?.metadata && typeof object.metadata === 'object' && 'mirror' in object.metadata),
  )
}

export function createPortalMirrorCommands(input: {
  previousDocument: CanvasDocument | null | undefined
  nextDocument: CanvasDocument
  commands: CanvasCommand[]
  sourcePortal: CanvasPortal
  targetPortal: CanvasPortal
  actorId?: string | null
  at?: string
}) {
  const at = input.at ?? input.nextDocument.updatedAt ?? new Date().toISOString()
  const previousObjects = new Map((input.previousDocument?.objects ?? []).map((object) => [object.id, object]))
  const nextObjects = new Map(input.nextDocument.objects.map((object) => [object.id, object]))
  const nextMirroredObjects = new Map(input.nextDocument.objects.map((object) => [object.id, object]))
  const mirroredCommands: CanvasCommand[] = []

  input.commands.forEach((command) => {
    if (command.type === 'object.upsert') {
      if (isMirroredObjectId(command.input.object.id)) {
        return
      }

      if (isMirroredObject(command.input.object)) {
        return
      }

      const previousObject = previousObjects.get(command.input.object.id) ?? null
      const nextObject = nextObjects.get(command.input.object.id) ?? command.input.object
      const wasInside = previousObject ? isObjectFullyWithinPortal(previousObject, input.sourcePortal) : false
      const isInside = isObjectFullyWithinPortal(nextObject, input.sourcePortal)
      const mirroredObjectId = createMirroredObjectId(command.input.object.id, input.targetPortal.id)

      if (!isInside && wasInside) {
        mirroredCommands.push({
          id: createCommandId(),
          type: 'object.delete',
          actorId: input.actorId ?? null,
          at,
          input: {
            objectId: mirroredObjectId,
          },
        })
        return
      }

      if (!isInside) {
        return
      }

      mirroredCommands.push({
        id: createCommandId(),
        type: 'object.upsert',
        actorId: input.actorId ?? null,
        at,
        input: {
          object: cloneSerializable(
            mirrorObjectAcrossPortals({
              object: nextObject,
              sourcePortal: input.sourcePortal,
              targetPortal: input.targetPortal,
              previousMirroredObject: nextMirroredObjects.get(mirroredObjectId) ?? null,
              at,
            }),
          ),
        },
      })
      return
    }

    if (command.type === 'object.delete') {
      if (isMirroredObjectId(command.input.objectId)) {
        return
      }

      const previousObject = previousObjects.get(command.input.objectId) ?? null
      if (!previousObject || !isObjectFullyWithinPortal(previousObject, input.sourcePortal)) {
        return
      }

      mirroredCommands.push({
        id: createCommandId(),
        type: 'object.delete',
        actorId: input.actorId ?? null,
        at,
        input: {
          objectId: createMirroredObjectId(command.input.objectId, input.targetPortal.id),
        },
      })
    }
  })

  return mirroredCommands
}
