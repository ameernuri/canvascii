import type { CanvasCommand, CanvasDocument, CanvasObject, CanvasPoint, CanvasSegment } from './contracts'

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

function nowIso(input?: string): string {
  return input ?? new Date().toISOString()
}

function getNextZIndex(document: CanvasDocument, canvasId: string): number {
  return (
    document.objects
      .filter((object) => object.canvasId === canvasId)
      .reduce((max, object) => Math.max(max, object.zIndex), -1) + 1
  )
}

export function getCanvasRootRegion(document: CanvasDocument, canvasId: string) {
  return document.regions.find((region) => region.canvasId === canvasId) ?? null
}

export function getCanvasObjectById(document: CanvasDocument, objectId: string) {
  return document.objects.find((object) => object.id === objectId) ?? null
}

function withObjectTouch(object: CanvasObject, at: string): CanvasObject {
  return {
    ...object,
    updatedAt: at,
    version: object.version + 1,
  }
}

function translatePoint(point: CanvasPoint, deltaRow: number, deltaCol: number): CanvasPoint {
  return {
    row: point.row + deltaRow,
    col: point.col + deltaCol,
  }
}

function translateSegment(segment: CanvasSegment, deltaRow: number, deltaCol: number): CanvasSegment {
  return {
    ...segment,
    start: translatePoint(segment.start, deltaRow, deltaCol),
    end: translatePoint(segment.end, deltaRow, deltaCol),
  }
}

function translateObject(object: CanvasObject, deltaRow: number, deltaCol: number, at: string): CanvasObject {
  switch (object.geometry.type) {
    case 'rectangle':
      return withObjectTouch(
        {
          ...object,
          geometry: {
            ...object.geometry,
            topLeft: translatePoint(object.geometry.topLeft, deltaRow, deltaCol),
            bottomRight: translatePoint(object.geometry.bottomRight, deltaRow, deltaCol),
          },
        },
        at,
      )
    case 'text':
      return withObjectTouch(
        {
          ...object,
          geometry: {
            ...object.geometry,
            start: translatePoint(object.geometry.start, deltaRow, deltaCol),
          },
        },
        at,
      )
    case 'line':
      return withObjectTouch(
        {
          ...object,
          geometry: {
            ...object.geometry,
            segment: translateSegment(object.geometry.segment, deltaRow, deltaCol),
          },
        },
        at,
      )
    case 'polyline':
      return withObjectTouch(
        {
          ...object,
          geometry: {
            ...object.geometry,
            segments: object.geometry.segments.map((segment) => translateSegment(segment, deltaRow, deltaCol)),
          },
        },
        at,
      )
    case 'group':
      return withObjectTouch(object, at)
  }
}

function buildObjectUpsertCommand(object: CanvasObject, actorId?: string | null, at?: string): Extract<CanvasCommand, { type: 'object.upsert' }> {
  const commandAt = nowIso(at)

  return {
    id: createCommandId(),
    type: 'object.upsert',
    actorId: actorId ?? null,
    at: commandAt,
    input: {
      object: cloneSerializable(object),
    },
  }
}

function createSegment(from: CanvasPoint, to: CanvasPoint): CanvasSegment {
  if (from.row === to.row) {
    return {
      axis: 'horizontal',
      start: cloneSerializable(from),
      end: cloneSerializable(to),
      direction: from.col <= to.col ? 'left-to-right' : 'right-to-left',
    }
  }

  if (from.col === to.col) {
    return {
      axis: 'vertical',
      start: cloneSerializable(from),
      end: cloneSerializable(to),
      direction: from.row <= to.row ? 'down' : 'up',
    }
  }

  throw new Error('Segments must be horizontal or vertical.')
}

export function createTextObjectCommand(input: {
  document: CanvasDocument
  canvasId?: string
  objectId?: string
  row: number
  col: number
  lines: string[]
  style?: Record<string, unknown>
  actorId?: string | null
  at?: string
}) {
  const at = nowIso(input.at)
  const canvasId = input.canvasId ?? input.document.activeCanvasId
  const region = getCanvasRootRegion(input.document, canvasId)
  if (!region) {
    throw new Error(`Canvas ${canvasId} does not have a root region.`)
  }

  const object: CanvasObject = {
    id:
      input.objectId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `obj:${Date.now()}-${Math.random().toString(16).slice(2)}`),
    canvasId,
    regionId: region.id,
    type: 'text',
    geometry: {
      type: 'text',
      start: {
        row: input.row,
        col: input.col,
      },
      lines: [...input.lines],
    },
    content: null,
    style: input.style ?? {},
    zIndex: getNextZIndex(input.document, canvasId),
    locked: false,
    createdAt: at,
    updatedAt: at,
    version: 1,
  }

  return buildObjectUpsertCommand(object, input.actorId, at)
}

export function createRectangleObjectCommand(input: {
  document: CanvasDocument
  canvasId?: string
  objectId?: string
  top: number
  left: number
  width: number
  height: number
  label?: string
  labelLines?: string[]
  style?: Record<string, unknown>
  actorId?: string | null
  at?: string
}) {
  const at = nowIso(input.at)
  const canvasId = input.canvasId ?? input.document.activeCanvasId
  const region = getCanvasRootRegion(input.document, canvasId)
  if (!region) {
    throw new Error(`Canvas ${canvasId} does not have a root region.`)
  }

  const object: CanvasObject = {
    id:
      input.objectId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `obj:${Date.now()}-${Math.random().toString(16).slice(2)}`),
    canvasId,
    regionId: region.id,
    type: 'rectangle',
    geometry: {
      type: 'rectangle',
      topLeft: { row: input.top, col: input.left },
      bottomRight: {
        row: input.top + input.height - 1,
        col: input.left + input.width - 1,
      },
      ...(input.label ? { label: input.label } : {}),
      ...(input.labelLines ? { labelLines: [...input.labelLines] } : {}),
    },
    content: null,
    style: input.style ?? {},
    zIndex: getNextZIndex(input.document, canvasId),
    locked: false,
    createdAt: at,
    updatedAt: at,
    version: 1,
  }

  return buildObjectUpsertCommand(object, input.actorId, at)
}

export function createLineObjectCommand(input: {
  document: CanvasDocument
  canvasId?: string
  objectId?: string
  from: CanvasPoint
  to: CanvasPoint
  style?: Record<string, unknown>
  actorId?: string | null
  at?: string
}) {
  const at = nowIso(input.at)
  const canvasId = input.canvasId ?? input.document.activeCanvasId
  const region = getCanvasRootRegion(input.document, canvasId)
  if (!region) {
    throw new Error(`Canvas ${canvasId} does not have a root region.`)
  }

  const object: CanvasObject = {
    id:
      input.objectId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `obj:${Date.now()}-${Math.random().toString(16).slice(2)}`),
    canvasId,
    regionId: region.id,
    type: 'line',
    geometry: {
      type: 'line',
      segment: createSegment(input.from, input.to),
    },
    content: null,
    style: input.style ?? {},
    zIndex: getNextZIndex(input.document, canvasId),
    locked: false,
    createdAt: at,
    updatedAt: at,
    version: 1,
  }

  return buildObjectUpsertCommand(object, input.actorId, at)
}

export function createPolylineObjectCommand(input: {
  document: CanvasDocument
  canvasId?: string
  objectId?: string
  points: CanvasPoint[]
  style?: Record<string, unknown>
  actorId?: string | null
  at?: string
}) {
  if (input.points.length < 2) {
    throw new Error('A path requires at least two points.')
  }

  const segments = input.points.slice(0, -1).map((point, index) => {
    const next = input.points[index + 1]
    return createSegment(point, next)
  })

  const at = nowIso(input.at)
  const canvasId = input.canvasId ?? input.document.activeCanvasId
  const region = getCanvasRootRegion(input.document, canvasId)
  if (!region) {
    throw new Error(`Canvas ${canvasId} does not have a root region.`)
  }

  const object: CanvasObject = {
    id:
      input.objectId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `obj:${Date.now()}-${Math.random().toString(16).slice(2)}`),
    canvasId,
    regionId: region.id,
    type: 'polyline',
    geometry: {
      type: 'polyline',
      segments,
    },
    content: null,
    style: input.style ?? {},
    zIndex: getNextZIndex(input.document, canvasId),
    locked: false,
    createdAt: at,
    updatedAt: at,
    version: 1,
  }

  return buildObjectUpsertCommand(object, input.actorId, at)
}

export function setTextObjectCommand(input: {
  document: CanvasDocument
  objectId: string
  lines: string[]
  actorId?: string | null
  at?: string
}) {
  const at = nowIso(input.at)
  const object = getCanvasObjectById(input.document, input.objectId)
  if (!object) {
    throw new Error(`Object ${input.objectId} was not found.`)
  }
  if (object.geometry.type !== 'text') {
    throw new Error(`Object ${input.objectId} is not a text object.`)
  }

  return buildObjectUpsertCommand(
    withObjectTouch(
      {
        ...object,
        geometry: {
          ...object.geometry,
          lines: [...input.lines],
        },
      },
      at,
    ),
    input.actorId,
    at,
  )
}

export function moveObjectCommand(input: {
  document: CanvasDocument
  objectId: string
  deltaRow: number
  deltaCol: number
  actorId?: string | null
  at?: string
}) {
  const at = nowIso(input.at)
  const object = getCanvasObjectById(input.document, input.objectId)
  if (!object) {
    throw new Error(`Object ${input.objectId} was not found.`)
  }

  return buildObjectUpsertCommand(
    translateObject(object, input.deltaRow, input.deltaCol, at),
    input.actorId,
    at,
  )
}
