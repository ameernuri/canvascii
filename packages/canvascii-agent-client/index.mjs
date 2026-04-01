import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import WebSocket from 'ws'
import * as Y from 'yjs'

class NodeWebSocketPolyfill {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.binaryType = 'arraybuffer'
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const wrapped = (first, second) => {
      switch (type) {
        case 'open':
          listener({ type: 'open', target: this })
          break
        case 'close':
          listener({
            type: 'close',
            code: first?.code ?? 1000,
            reason: first?.reason ?? '',
            wasClean: first?.wasClean ?? true,
            target: this,
          })
          break
        case 'error':
          listener(first)
          break
        case 'message': {
          const rawData = first
          const data =
            rawData instanceof ArrayBuffer
              ? rawData
              : ArrayBuffer.isView(rawData)
                ? rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength)
                : rawData?.buffer instanceof ArrayBuffer
                  ? rawData.buffer.slice(rawData.byteOffset ?? 0, (rawData.byteOffset ?? 0) + (rawData.byteLength ?? rawData.length ?? 0))
                  : rawData
          listener({
            type: 'message',
            data,
            isBinary: Boolean(second),
            target: this,
          })
          break
        }
        default:
          listener(first)
      }
    }

    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Map())
    }
    this.listeners.get(type).set(listener, wrapped)
    this.socket.on(type, wrapped)
  }

  removeEventListener(type, listener) {
    const wrapped = this.listeners.get(type)?.get(listener)
    if (!wrapped) return
    this.socket.off(type, wrapped)
    this.listeners.get(type)?.delete(listener)
  }

  send(payload) {
    this.socket.send(payload)
  }

  close() {
    this.socket.close()
  }

  get readyState() {
    return this.socket.readyState
  }

  get url() {
    return this.socket.url
  }

  get protocol() {
    return this.socket.protocol
  }

  set binaryType(value) {
    this._binaryType = value
    if (this.socket) {
      this.socket.binaryType = value
    }
  }

  get binaryType() {
    return this._binaryType
  }
}
const DEFAULT_APP_URL = process.env.CANVASCII_BASE_URL || 'http://127.0.0.1:5001'
const DEFAULT_COLLAB_URL = process.env.CANVASCII_COLLAB_URL || 'ws://127.0.0.1:5002'
const ROOM_DOCUMENT_TIMEOUT_MS = 10_000
const PRESENCE_STALE_AFTER_MS = 30_000
const STATELESS_COMMAND_REQUEST_KIND = 'canvas.command.request'
const STATELESS_COMMAND_RESULT_KIND = 'canvas.command.result'
const DEFAULT_CANVAS_ROWS = 75
const DEFAULT_CANVAS_COLS = 250
const DEFAULT_EXPAND_ROWS = 40
const DEFAULT_EXPAND_COLS = 125

function trimOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isFreshPresence(presence, now = Date.now()) {
  if (!presence || typeof presence !== 'object') return false
  const updatedAt = trimOrNull(presence.updatedAt)
  if (!updatedAt) {
    return (presence.actorType || 'human') !== 'agent'
  }

  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) {
    return (presence.actorType || 'human') !== 'agent'
  }

  return now - timestamp <= PRESENCE_STALE_AFTER_MS
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function parseShareUrl(shareUrl) {
  const url = new URL(shareUrl)
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    canvasId: url.searchParams.get('canvas')?.trim() || null,
    shareToken: url.searchParams.get('share')?.trim() || null,
  }
}

function deriveCollabUrl(baseUrl) {
  const parsed = new URL(baseUrl)
  const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  const hostname = parsed.hostname
  const port = parsed.port === '5001' ? '5002' : parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return `${protocol}//${hostname}:${port}`
}

function makeRequestHeaders(input = {}) {
  const headers = {
    accept: 'application/json',
  }
  if (input.shareToken) {
    headers['x-canvascii-share-token'] = input.shareToken
  }
  if (input.sessionCookie) {
    headers.cookie = input.sessionCookie
  }
  return headers
}

async function resolveLiveDocumentId(input = {}) {
  const baseUrl = trimOrNull(input.baseUrl) || DEFAULT_APP_URL
  const canvasId = trimOrNull(input.canvasId)
  if (!canvasId) {
    throw new Error('canvasId is required to resolve the live document.')
  }

  const url = new URL('/api/v1/canvascii/collab-access', baseUrl)
  url.searchParams.set('id', canvasId)

  const response = await fetch(url, {
    method: 'GET',
    headers: makeRequestHeaders(input),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.success) {
    throw new Error(
      payload?.error?.message ||
        `Unable to resolve the live document for canvas ${canvasId}. Request failed with status ${response.status}.`,
    )
  }

  const documentId = trimOrNull(payload?.data?.documentId)
  if (!documentId) {
    throw new Error(`Canvas ${canvasId} did not return a live documentId.`)
  }

  return documentId
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session:${crypto.randomUUID()}`
  }

  return `session:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createActorId(prefix = 'agent') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }

  return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function colorFromId(value) {
  const palette = ['#f97316', '#38bdf8', '#22c55e', '#f43f5e', '#a855f7', '#facc15']
  const hash = Array.from(String(value)).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palette[hash % palette.length]
}

function createObjectId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `obj:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cmd:${crypto.randomUUID()}`
  }

  return `cmd:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `req:${crypto.randomUUID()}`
  }

  return `req:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getCanvasRootRegion(document, canvasId) {
  return document.regions.find((region) => region.canvasId === canvasId) ?? null
}

function getCanvasById(document, canvasId) {
  return document.canvases.find((canvas) => canvas.id === canvasId) ?? null
}

function getCanvasObjectById(document, objectId) {
  return document.objects.find((object) => object.id === objectId) ?? null
}

function getNextZIndex(document, canvasId) {
  return document.objects
    .filter((object) => object.canvasId === canvasId)
    .reduce((max, object) => Math.max(max, object.zIndex), -1) + 1
}

function touchDocument(document) {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    version: (document.version ?? 0) + 1,
  }
}

function touchObject(object) {
  return {
    ...object,
    updatedAt: new Date().toISOString(),
    version: (object.version ?? 0) + 1,
  }
}

function buildObjectUpsertCommand(object, actorId = null, at = new Date().toISOString()) {
  return {
    id: createCommandId(),
    type: 'object.upsert',
    actorId,
    at,
    input: {
      object: clone(object),
    },
  }
}

function buildObjectDeleteCommand(objectId, actorId = null, at = new Date().toISOString()) {
  return {
    id: createCommandId(),
    type: 'object.delete',
    actorId,
    at,
    input: {
      objectId,
    },
  }
}

function buildCanvasUpsertCommand(document, input, actorId = null, at = new Date().toISOString()) {
  const canvas = getCanvasById(document, input.canvasId)
  const region = getCanvasRootRegion(document, input.canvasId)
  if (!canvas) {
    throw new Error(`Canvas ${input.canvasId} was not found.`)
  }
  if (!region) {
    throw new Error(`Canvas ${input.canvasId} does not have a root region.`)
  }

  return {
    id: createCommandId(),
    type: 'canvas.upsert',
    actorId,
    at,
    input: {
      canvas: clone(input.canvas ?? canvas),
      region: clone(input.region ?? region),
    },
  }
}

function translatePoint(point, deltaRow, deltaCol) {
  return {
    row: point.row + deltaRow,
    col: point.col + deltaCol,
  }
}

function translateSegment(segment, deltaRow, deltaCol) {
  return {
    ...segment,
    start: translatePoint(segment.start, deltaRow, deltaCol),
    end: translatePoint(segment.end, deltaRow, deltaCol),
  }
}

function moveObjectValue(object, deltaRow, deltaCol) {
  switch (object.geometry.type) {
    case 'rectangle':
      return touchObject({
        ...object,
        geometry: {
          ...object.geometry,
          topLeft: translatePoint(object.geometry.topLeft, deltaRow, deltaCol),
          bottomRight: translatePoint(object.geometry.bottomRight, deltaRow, deltaCol),
        },
      })
    case 'text':
      return touchObject({
        ...object,
        geometry: {
          ...object.geometry,
          start: translatePoint(object.geometry.start, deltaRow, deltaCol),
        },
      })
    case 'line':
      return touchObject({
        ...object,
        geometry: {
          ...object.geometry,
          segment: translateSegment(object.geometry.segment, deltaRow, deltaCol),
        },
      })
    case 'polyline':
      return touchObject({
        ...object,
        geometry: {
          ...object.geometry,
          segments: object.geometry.segments.map((segment) => translateSegment(segment, deltaRow, deltaCol)),
        },
      })
    case 'group':
      return touchObject(object)
  }
}

function createGrid(rows, cols) {
  return Array.from({ length: Math.max(0, rows) }, () => Array.from({ length: Math.max(0, cols) }, () => ' '))
}

function writeCell(grid, row, col, char) {
  if (!grid[row] || grid[row][col] == null) return
  const nextChar = Array.from(char)[0] ?? ' '
  const current = grid[row][col]
  if (current !== ' ' && current !== nextChar && current !== '+' && nextChar !== ' ') {
    grid[row][col] = '+'
    return
  }
  grid[row][col] = nextChar
}

function renderChars(mode) {
  if (mode === 'UNICODE') {
    return {
      horizontal: '─',
      vertical: '│',
      topLeft: '┌',
      topRight: '┐',
      bottomLeft: '└',
      bottomRight: '┘',
    }
  }

  return {
    horizontal: '-',
    vertical: '|',
    topLeft: '+',
    topRight: '+',
    bottomLeft: '+',
    bottomRight: '+',
  }
}

function trimGrid(grid, padding = 1) {
  let top = Number.POSITIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  let bottom = -1
  let right = -1

  grid.forEach((row, rowIndex) => {
    row.forEach((char, colIndex) => {
      if (char === ' ') return
      top = Math.min(top, rowIndex)
      left = Math.min(left, colIndex)
      bottom = Math.max(bottom, rowIndex)
      right = Math.max(right, colIndex)
    })
  })

  if (bottom === -1) {
    return {
      offsetRow: 0,
      offsetCol: 0,
      grid: [[' ']],
    }
  }

  const startRow = Math.max(0, top - padding)
  const startCol = Math.max(0, left - padding)
  const endRow = Math.min(grid.length - 1, bottom + padding)
  const endCol = Math.min(grid[0]?.length ? grid[0].length - 1 : 0, right + padding)

  return {
    offsetRow: startRow,
    offsetCol: startCol,
    grid: grid.slice(startRow, endRow + 1).map((row) => row.slice(startCol, endCol + 1)),
  }
}

function summarizeObject(object) {
  const bounds = getObjectBounds(object)
  const textLines = getObjectTextLines(object)
  switch (object.geometry.type) {
    case 'rectangle':
      return {
        id: object.id,
        canvasId: object.canvasId,
        type: object.type,
        zIndex: object.zIndex,
        version: object.version ?? 0,
        bounds,
        topLeft: object.geometry.topLeft,
        bottomRight: object.geometry.bottomRight,
        label: object.geometry.label ?? null,
        bodyLines: object.geometry.labelLines ?? [],
        text: textLines.join('\n'),
      }
    case 'text':
      return {
        id: object.id,
        canvasId: object.canvasId,
        type: object.type,
        zIndex: object.zIndex,
        version: object.version ?? 0,
        bounds,
        start: object.geometry.start,
        lines: object.geometry.lines,
        text: textLines.join('\n'),
      }
    case 'line':
      return {
        id: object.id,
        canvasId: object.canvasId,
        type: object.type,
        zIndex: object.zIndex,
        version: object.version ?? 0,
        bounds,
        segment: object.geometry.segment,
        labelLines: object.metadata?.labelLines ?? [],
        text: textLines.join('\n'),
      }
    case 'polyline':
      return {
        id: object.id,
        canvasId: object.canvasId,
        type: object.type,
        zIndex: object.zIndex,
        version: object.version ?? 0,
        bounds,
        segments: object.geometry.segments,
        labelLines: object.metadata?.labelLines ?? [],
        text: textLines.join('\n'),
      }
    default:
      return {
        id: object.id,
        canvasId: object.canvasId,
        type: object.type,
        zIndex: object.zIndex,
        version: object.version ?? 0,
        bounds,
        text: textLines.join('\n'),
      }
  }
}

/**
 * Convert a live object into the same JSON shape the bulk upsert tools accept.
 * This gives agents a round-trippable format for reading a region and writing it back.
 */
function serializeObjectAsSpec(object) {
  const style = object.style ? clone(object.style) : undefined
  switch (object.geometry.type) {
    case 'rectangle': {
      const top = Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const left = Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      const bottom = Math.max(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const right = Math.max(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      return {
        id: object.id,
        type: 'rectangle',
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
        ...(object.geometry.label ? { label: object.geometry.label } : {}),
        ...(Array.isArray(object.geometry.labelLines) ? { bodyLines: [...object.geometry.labelLines] } : {}),
        ...(style ? { style } : {}),
      }
    }
    case 'text':
      return {
        id: object.id,
        type: 'text',
        row: object.geometry.start.row,
        col: object.geometry.start.col,
        lines: [...(object.geometry.lines ?? [])],
        ...(style ? { style } : {}),
      }
    case 'line':
      return {
        id: object.id,
        type: 'line',
        from: clone(object.geometry.segment.start),
        to: clone(object.geometry.segment.end),
        ...(Array.isArray(object.metadata?.labelLines) ? { labelLines: [...object.metadata.labelLines] } : {}),
        ...(style ? { style } : {}),
      }
    case 'polyline': {
      const points = []
      const segments = object.geometry.segments ?? []
      if (segments.length > 0) {
        points.push(clone(segments[0].start))
        for (const segment of segments) {
          points.push(clone(segment.end))
        }
      }
      return {
        id: object.id,
        type: 'path',
        points,
        ...(Array.isArray(object.metadata?.labelLines) ? { labelLines: [...object.metadata.labelLines] } : {}),
        ...(style ? { style } : {}),
      }
    }
    default:
      return {
        id: object.id,
        type: object.geometry.type,
        ...(style ? { style } : {}),
      }
  }
}

function getObjectBounds(object) {
  switch (object?.geometry?.type) {
    case 'rectangle': {
      const top = Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const left = Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      const bottom = Math.max(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const right = Math.max(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
      }
    }
    case 'text': {
      const lines = object.geometry.lines ?? []
      const width = lines.reduce((max, line) => Math.max(max, Array.from(line).length), 0)
      return {
        top: object.geometry.start.row,
        left: object.geometry.start.col,
        width: Math.max(1, width),
        height: Math.max(1, lines.length || 1),
      }
    }
    case 'line': {
      const top = Math.min(object.geometry.segment.start.row, object.geometry.segment.end.row)
      const left = Math.min(object.geometry.segment.start.col, object.geometry.segment.end.col)
      const bottom = Math.max(object.geometry.segment.start.row, object.geometry.segment.end.row)
      const right = Math.max(object.geometry.segment.start.col, object.geometry.segment.end.col)
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
      }
    }
    case 'polyline': {
      const points = object.geometry.segments.flatMap((segment) => [segment.start, segment.end])
      const rows = points.map((point) => point.row)
      const cols = points.map((point) => point.col)
      const top = Math.min(...rows)
      const left = Math.min(...cols)
      const bottom = Math.max(...rows)
      const right = Math.max(...cols)
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
      }
    }
    default:
      return null
  }
}

function normalizeStackGap(value) {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'shared') {
    return -1
  }
  if (Number.isFinite(Number(value))) {
    return Number(value)
  }
  return 0
}

function alignObjectValue(object, edge, reference) {
  const bounds = getObjectBounds(object)
  if (!bounds) return touchObject(object)
  let nextTop = bounds.top
  let nextLeft = bounds.left
  if (edge === 'left') nextLeft = reference.left
  if (edge === 'right') nextLeft = reference.right - bounds.width + 1
  if (edge === 'top') nextTop = reference.top
  if (edge === 'bottom') nextTop = reference.bottom - bounds.height + 1
  if (edge === 'hcenter') nextLeft = reference.centerX - Math.floor(bounds.width / 2)
  if (edge === 'vcenter') nextTop = reference.centerY - Math.floor(bounds.height / 2)
  return moveObjectValue(object, nextTop - bounds.top, nextLeft - bounds.left)
}

function packObjectValues(objects, axis, gap, align) {
  if (!Array.isArray(objects) || objects.length === 0) return []
  const bounds = objects.map((object) => getObjectBounds(object))
  if (bounds.some((entry) => !entry)) return objects.map((object) => touchObject(object))

  if (axis === 'vertical') {
    const baselineLeft = Math.min(...bounds.map((entry) => entry.left))
    const bandWidth = Math.max(...bounds.map((entry) => entry.width))
    let cursorTop = bounds[0].top
    return objects.map((object, index) => {
      const entry = bounds[index]
      const nextLeft =
        align === 'center'
          ? baselineLeft + Math.floor((bandWidth - entry.width) / 2)
          : align === 'end'
            ? baselineLeft + (bandWidth - entry.width)
            : baselineLeft
      const moved = moveObjectValue(object, cursorTop - entry.top, nextLeft - entry.left)
      cursorTop += entry.height + gap
      return moved
    })
  }

  const baselineTop = Math.min(...bounds.map((entry) => entry.top))
  const bandHeight = Math.max(...bounds.map((entry) => entry.height))
  let cursorLeft = bounds[0].left
  return objects.map((object, index) => {
    const entry = bounds[index]
    const nextTop =
      align === 'center'
        ? baselineTop + Math.floor((bandHeight - entry.height) / 2)
        : align === 'end'
          ? baselineTop + (bandHeight - entry.height)
          : baselineTop
    const moved = moveObjectValue(object, nextTop - entry.top, cursorLeft - entry.left)
    cursorLeft += entry.width + gap
    return moved
  })
}

function patchObjectValue(object, input) {
  const at = new Date().toISOString()
  if (object.geometry.type === 'rectangle') {
    const top = input.top ?? Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
    const left = input.left ?? Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
    const width = input.width ?? Math.abs(object.geometry.bottomRight.col - object.geometry.topLeft.col) + 1
    const height = input.height ?? Math.abs(object.geometry.bottomRight.row - object.geometry.topLeft.row) + 1
    return touchObject({
      ...object,
      updatedAt: at,
      geometry: {
        ...object.geometry,
        topLeft: { row: top, col: left },
        bottomRight: { row: top + height - 1, col: left + width - 1 },
        ...(input.title != null ? { label: input.title } : {}),
        ...(input.body != null
          ? { labelLines: String(input.body).split('\n') }
          : input.text != null
            ? { labelLines: String(input.text).split('\n') }
            : {}),
      },
      ...(input.alignment
        ? {
            style: {
              ...(object.style ?? {}),
              rectangleTextAlignH: input.alignment,
            },
          }
        : {}),
    })
  }
  if (object.geometry.type === 'text') {
    let nextLines = object.geometry.lines ?? []
    if (input.text != null || input.body != null) {
      nextLines = String(input.text ?? input.body ?? '').split('\n')
    }
    if (input.alignment) {
      nextLines = alignTextLines(nextLines, input.alignment)
    }
    return touchObject({
      ...object,
      updatedAt: at,
      geometry: {
        ...object.geometry,
        start: {
          row: input.row ?? input.top ?? object.geometry.start.row,
          col: input.col ?? input.left ?? object.geometry.start.col,
        },
        lines: nextLines,
      },
    })
  }
  if (object.geometry.type === 'line') {
    if (input.text == null && input.body == null) return touchObject(object)
    return touchObject({
      ...object,
      updatedAt: at,
      geometry: {
        ...object.geometry,
        labelLines: String(input.text ?? input.body ?? '').split('\n'),
      },
    })
  }
  if (object.geometry.type === 'polyline') {
    if (input.text == null && input.body == null) return touchObject(object)
    return touchObject({
      ...object,
      updatedAt: at,
      metadata: {
        ...(object.metadata ?? {}),
        labelLines: String(input.text ?? input.body ?? '').split('\n'),
      },
    })
  }
  return touchObject(object)
}

function clampCanvasSize(rows, cols) {
  return {
    rows: Math.max(1, Math.floor(rows)),
    cols: Math.max(1, Math.floor(cols)),
  }
}

function getCanvasContentBounds(document, canvasId) {
  const objectBounds = document.objects
    .filter((object) => object.canvasId === canvasId)
    .map((object) => getObjectBounds(object))
    .filter(Boolean)
  const canvas = getCanvasById(document, canvasId)
  const portalViews = Array.isArray(canvas?.metadata?.portalViews) ? canvas.metadata.portalViews : []
  const portalBounds = portalViews.map((portal) => ({
    top: portal.rect.top,
    left: portal.rect.left,
    width: portal.rect.width,
    height: portal.rect.height,
  }))
  const bounds = [...objectBounds, ...portalBounds]
  if (bounds.length === 0) {
    return null
  }

  const top = Math.min(...bounds.map((entry) => entry.top))
  const left = Math.min(...bounds.map((entry) => entry.left))
  const right = Math.max(...bounds.map((entry) => entry.left + entry.width - 1))
  const bottom = Math.max(...bounds.map((entry) => entry.top + entry.height - 1))
  return {
    top,
    left,
    width: right - left + 1,
    height: bottom - top + 1,
  }
}

function getShrinkToFitCanvasSize(document, canvasId) {
  const canvas = getCanvasById(document, canvasId)
  if (!canvas) {
    throw new Error(`Canvas ${canvasId} was not found.`)
  }

  const bounds = getCanvasContentBounds(document, canvasId)
  if (!bounds) {
    return {
      rows: Math.min(canvas.bounds.height, DEFAULT_CANVAS_ROWS),
      cols: Math.min(canvas.bounds.width, DEFAULT_CANVAS_COLS),
    }
  }

  return clampCanvasSize(bounds.top + bounds.height, bounds.left + bounds.width)
}

function rectWithinRect(inner, outer) {
  return (
    inner.top >= outer.top &&
    inner.left >= outer.left &&
    inner.top + inner.height <= outer.top + outer.height &&
    inner.left + inner.width <= outer.left + outer.width
  )
}

function rectsIntersect(left, right) {
  return (
    left.top < right.top + right.height &&
    left.top + left.height > right.top &&
    left.left < right.left + right.width &&
    left.left + left.width > right.left
  )
}

function normalizeSearchQuery(query) {
  if (typeof query !== 'string') return null
  const trimmed = query.trim()
  return trimmed.length > 0 ? trimmed : null
}

function makeSearchableLine(line, caseSensitive) {
  return caseSensitive ? line : line.toLowerCase()
}

function searchRenderedLines(lines, query, input = {}) {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return []

  const caseSensitive = input.caseSensitive === true
  const needle = makeSearchableLine(normalizedQuery, caseSensitive)
  const matches = []

  lines.forEach((line, index) => {
    const haystack = makeSearchableLine(line, caseSensitive)
    let fromIndex = 0
    while (fromIndex <= haystack.length) {
      const matchIndex = haystack.indexOf(needle, fromIndex)
      if (matchIndex === -1) break
      matches.push({
        rowOffset: index,
        colOffset: matchIndex,
        match: line.slice(matchIndex, matchIndex + normalizedQuery.length),
        line,
      })
      fromIndex = matchIndex + Math.max(1, normalizedQuery.length)
    }
  })

  return matches
}

function summarizeObjectChange(previousObject, nextObject) {
  if (!previousObject && nextObject) {
    return {
      type: 'created',
      object: summarizeObject(nextObject),
    }
  }

  if (previousObject && !nextObject) {
    return {
      type: 'deleted',
      object: summarizeObject(previousObject),
    }
  }

  if (!previousObject || !nextObject) {
    return null
  }

  if (JSON.stringify(previousObject) === JSON.stringify(nextObject)) {
    return null
  }

  return {
    type: 'updated',
    before: summarizeObject(previousObject),
    after: summarizeObject(nextObject),
  }
}

function getObjectTextLines(object) {
  switch (object?.geometry?.type) {
    case 'text':
      return object.geometry.lines ?? []
    case 'rectangle':
      return [object.geometry.label ?? '', ...(object.geometry.labelLines ?? [])].filter(Boolean)
    case 'line':
    case 'polyline':
      return object.metadata?.labelLines ?? object.geometry.labelLines ?? []
    default:
      return []
  }
}

function alignTextLines(lines, alignment) {
  const trimmedLines = lines.map((line) => String(line ?? '').trim())
  const width = Math.max(1, ...trimmedLines.map((line) => Array.from(line).length))

  return trimmedLines.map((line) => {
    const lineLength = Array.from(line).length
    const remaining = Math.max(0, width - lineLength)
    if (alignment === 'RIGHT') {
      return `${' '.repeat(remaining)}${line}`
    }
    if (alignment === 'CENTER') {
      const left = Math.floor(remaining / 2)
      const right = remaining - left
      return `${' '.repeat(left)}${line}${' '.repeat(right)}`
    }
    return line
  })
}

function normalizeObjectType(type) {
  const value = trimOrNull(type)
  if (!value) return null
  const normalized = value.toLowerCase()
  return normalized === 'path' ? 'polyline' : normalized
}

function buildRectangleStyle(input = {}) {
  const preset = trimOrNull(input.stylePreset)?.toLowerCase()
  const explicitStyle = input.style && typeof input.style === 'object' ? { ...input.style } : {}

  if (preset === 'wireframe') {
    return {
      lineStyle: 'LIGHT',
      rectangleFill: 'NONE',
      rectangleBorder: 'LINE',
      ...(explicitStyle ?? {}),
    }
  }

  return explicitStyle
}

function normalizeRectangleBodyLines(input = {}) {
  if (Array.isArray(input.bodyLines)) return [...input.bodyLines]
  if (typeof input.body === 'string') return input.body.split('\n')
  if (Array.isArray(input.labelLines)) return [...input.labelLines]
  return []
}

function matchesObjectQuery(object, query = {}, canvasId) {
  if (canvasId && object.canvasId !== canvasId) {
    return false
  }

  const normalizedTypes = Array.isArray(query.types)
    ? query.types.map(normalizeObjectType).filter(Boolean)
    : normalizeObjectType(query.type)
      ? [normalizeObjectType(query.type)]
      : []

  const objectType = normalizeObjectType(object.geometry?.type || object.type)
  if (normalizedTypes.length > 0 && !normalizedTypes.includes(objectType)) {
    return false
  }

  const bounds = getObjectBounds(object)
  const withinRect =
    Number.isInteger(query.withinTop) &&
    Number.isInteger(query.withinLeft) &&
    Number.isInteger(query.withinWidth) &&
    Number.isInteger(query.withinHeight)
      ? {
          top: query.withinTop,
          left: query.withinLeft,
          width: query.withinWidth,
          height: query.withinHeight,
        }
      : null
  const intersectsRect =
    Number.isInteger(query.intersectsTop) &&
    Number.isInteger(query.intersectsLeft) &&
    Number.isInteger(query.intersectsWidth) &&
    Number.isInteger(query.intersectsHeight)
      ? {
          top: query.intersectsTop,
          left: query.intersectsLeft,
          width: query.intersectsWidth,
          height: query.intersectsHeight,
        }
      : null

  if (withinRect && (!bounds || !rectWithinRect(bounds, withinRect))) {
    return false
  }

  if (intersectsRect && (!bounds || !rectsIntersect(bounds, intersectsRect))) {
    return false
  }

  const joinedText = getObjectTextLines(object).join('\n')
  const normalizedText = query.caseSensitive ? joinedText : joinedText.toLowerCase()

  const labelContains = normalizeSearchQuery(query.labelContains)
  if (labelContains) {
    const needle = query.caseSensitive ? labelContains : labelContains.toLowerCase()
    if (!normalizedText.includes(needle)) {
      return false
    }
  }

  const textContains = normalizeSearchQuery(query.textContains)
  if (textContains) {
    const needle = query.caseSensitive ? textContains : textContains.toLowerCase()
    if (!normalizedText.includes(needle)) {
      return false
    }
  }

  return true
}

function buildObjectUpsertFromSpec(spec, input) {
  const at = input.at
  const existingObject = input.existingObject ?? null
  const base = {
    ...(existingObject ? clone(existingObject) : {}),
    id: spec.id || existingObject?.id || createObjectId(),
    canvasId: input.canvasId,
    regionId: input.regionId,
    content: existingObject?.content ?? null,
    style: spec.style ?? existingObject?.style ?? {},
    zIndex: Number.isInteger(spec.zIndex) ? spec.zIndex : existingObject?.zIndex ?? input.zIndex,
    locked: existingObject?.locked ?? false,
    createdAt: existingObject?.createdAt ?? at,
    updatedAt: at,
    version: existingObject?.version ?? 1,
  }

  switch (spec.type) {
    case 'text':
      return buildObjectUpsertCommand(
        existingObject
          ? touchObject({
              ...base,
              type: 'text',
              geometry: {
                type: 'text',
                start: { row: spec.row, col: spec.col },
                lines: [...(spec.lines ?? String(spec.text ?? '').split('\n'))],
              },
            })
          : {
              ...base,
              type: 'text',
              geometry: {
                type: 'text',
                start: { row: spec.row, col: spec.col },
                lines: [...(spec.lines ?? String(spec.text ?? '').split('\n'))],
              },
            },
        input.actorId,
        at,
      )
    case 'rectangle':
      return buildObjectUpsertCommand(
        existingObject
          ? touchObject({
              ...base,
              type: 'rectangle',
              geometry: {
                type: 'rectangle',
                topLeft: { row: spec.top, col: spec.left },
                bottomRight: { row: spec.top + spec.height - 1, col: spec.left + spec.width - 1 },
                ...(spec.label ? { label: spec.label } : {}),
                labelLines: normalizeRectangleBodyLines(spec),
              },
              style: buildRectangleStyle(spec),
            })
          : {
              ...base,
              type: 'rectangle',
              geometry: {
                type: 'rectangle',
                topLeft: { row: spec.top, col: spec.left },
                bottomRight: { row: spec.top + spec.height - 1, col: spec.left + spec.width - 1 },
                ...(spec.label ? { label: spec.label } : {}),
                labelLines: normalizeRectangleBodyLines(spec),
              },
              style: buildRectangleStyle(spec),
            },
        input.actorId,
        at,
      )
    case 'line': {
      const axis = spec.from.row === spec.to.row ? 'horizontal' : spec.from.col === spec.to.col ? 'vertical' : null
      if (!axis) throw new Error('Lines must be horizontal or vertical.')
      return buildObjectUpsertCommand(
        existingObject
          ? touchObject({
              ...base,
              type: 'line',
              geometry: {
                type: 'line',
                segment: {
                  axis,
                  start: clone(spec.from),
                  end: clone(spec.to),
                  direction:
                    axis === 'horizontal'
                      ? spec.from.col <= spec.to.col
                        ? 'left-to-right'
                        : 'right-to-left'
                      : spec.from.row <= spec.to.row
                        ? 'down'
                        : 'up',
                },
              },
              metadata: {
                ...(existingObject?.metadata ?? {}),
                labelLines: [...(spec.labelLines ?? [])],
              },
            })
          : {
              ...base,
              type: 'line',
              geometry: {
                type: 'line',
                segment: {
                  axis,
                  start: clone(spec.from),
                  end: clone(spec.to),
                  direction:
                    axis === 'horizontal'
                      ? spec.from.col <= spec.to.col
                        ? 'left-to-right'
                        : 'right-to-left'
                      : spec.from.row <= spec.to.row
                        ? 'down'
                        : 'up',
                },
              },
              metadata: {
                labelLines: [...(spec.labelLines ?? [])],
              },
            },
        input.actorId,
        at,
      )
    }
    case 'path':
    case 'polyline': {
      const points = spec.points ?? []
      if (points.length < 2) {
        throw new Error('Path objects require at least two points.')
      }
      const segments = points.slice(0, -1).map((point, index) => {
        const next = points[index + 1]
        const axis = point.row === next.row ? 'horizontal' : point.col === next.col ? 'vertical' : null
        if (!axis) throw new Error('Path points must form orthogonal segments.')
        return {
          axis,
          start: clone(point),
          end: clone(next),
          direction:
            axis === 'horizontal'
              ? point.col <= next.col
                ? 'left-to-right'
                : 'right-to-left'
              : point.row <= next.row
                ? 'down'
                : 'up',
        }
      })
      return buildObjectUpsertCommand(
        existingObject
          ? touchObject({
              ...base,
              type: 'polyline',
              geometry: {
                type: 'polyline',
                segments,
              },
              metadata: {
                ...(existingObject?.metadata ?? {}),
                labelLines: [...(spec.labelLines ?? [])],
              },
            })
          : {
              ...base,
              type: 'polyline',
              geometry: {
                type: 'polyline',
                segments,
              },
              metadata: {
                labelLines: [...(spec.labelLines ?? [])],
              },
            },
        input.actorId,
        at,
      )
    }
    default:
      throw new Error(`Unsupported replace-region object type: ${spec.type}`)
  }
}

export class CanvasciiAgentClient {
  constructor(input = {}) {
    this.baseUrl = trimOrNull(input.baseUrl) || DEFAULT_APP_URL
    this.collabUrl = trimOrNull(input.collabUrl) || deriveCollabUrl(this.baseUrl) || DEFAULT_COLLAB_URL
    this.requestedCanvasId = trimOrNull(input.canvasId)
    this.canvasId = trimOrNull(input.canvasId)
    this.documentId = trimOrNull(input.documentId)
    this.shareToken = trimOrNull(input.shareToken)
    this.sessionCookie = trimOrNull(input.sessionCookie)
    this.collabToken = trimOrNull(input.collabToken)
    this.actorType = 'agent'
    this.actorId = trimOrNull(input.actorId) || createActorId('agent')
    this.sessionId = trimOrNull(input.sessionId) || createSessionId()
    this.name = trimOrNull(input.name) || trimOrNull(input.agentName) || 'Canvascii Agent'
    this.color = trimOrNull(input.color) || trimOrNull(input.agentColor) || colorFromId(this.actorId)
    this.activeTool = trimOrNull(input.activeTool)
    this.intent = null
    this.status = 'idle'
    this.cursor = null
    this.selection = null
    this.viewport = null
    this.draft = null
    this.doc = null
    this.websocketProvider = null
    this.provider = null
    this.root = null
    this.pendingStatelessRequests = new Map()
    this.boundStatelessHandler = this.handleStatelessMessage.bind(this)
  }

  static fromShareUrl(shareUrl, input = {}) {
    const parsed = parseShareUrl(shareUrl)
    return new CanvasciiAgentClient({
      ...input,
      baseUrl: parsed.baseUrl,
      canvasId: parsed.canvasId,
      shareToken: parsed.shareToken,
    })
  }

  async connect(input = {}) {
    if (this.provider) return this

    const shareUrl = trimOrNull(input.shareUrl)
    if (shareUrl) {
      const parsed = parseShareUrl(shareUrl)
      this.baseUrl = parsed.baseUrl
      this.requestedCanvasId = parsed.canvasId
      this.canvasId = parsed.canvasId
      this.shareToken = parsed.shareToken
      this.documentId = trimOrNull(input.documentId) || null
      this.sessionCookie = trimOrNull(input.sessionCookie) || this.sessionCookie
      this.collabUrl = trimOrNull(input.collabUrl) || deriveCollabUrl(parsed.baseUrl) || DEFAULT_COLLAB_URL
    } else if (trimOrNull(input.collabUrl)) {
      this.collabUrl = input.collabUrl
    }

    this.name = trimOrNull(input.name) || trimOrNull(input.agentName) || this.name
    this.color = trimOrNull(input.color) || trimOrNull(input.agentColor) || this.color
    this.documentId = trimOrNull(input.documentId) || this.documentId
    this.sessionCookie = trimOrNull(input.sessionCookie) || this.sessionCookie
    this.collabToken = trimOrNull(input.collabToken) || this.collabToken || (this.shareToken ? `share:${this.shareToken}` : null)
    if (!this.requestedCanvasId && !this.canvasId) {
      throw new Error('canvasId is required to join a canvas room.')
    }
    if (!this.collabToken) {
      throw new Error('A collab token or share token is required to join a canvas room.')
    }
    if (!this.documentId) {
      this.documentId = await resolveLiveDocumentId({
        baseUrl: this.baseUrl,
        canvasId: this.requestedCanvasId || this.canvasId,
        shareToken: this.shareToken,
        sessionCookie: this.sessionCookie,
      })
    }

    this.doc = new Y.Doc()
    this.websocketProvider = new HocuspocusProviderWebsocket({
      url: this.collabUrl,
      WebSocketPolyfill: NodeWebSocketPolyfill,
    })
    this.provider = new HocuspocusProvider({
      name: `canvascii:${this.documentId}`,
      document: this.doc,
      websocketProvider: this.websocketProvider,
      token: this.collabToken,
    })
    this.root = this.doc.getMap('canvascii')
    this.provider.on('stateless', this.boundStatelessHandler)

    await new Promise((resolve, reject) => {
      const resolveIfSynced = () => {
        if (!this.provider?.isSynced) return false
        clearTimeout(timeout)
        clearInterval(interval)
        resolve()
        return true
      }

      const timeout = setTimeout(() => {
        clearInterval(interval)
        reject(new Error('Timed out waiting for websocket sync.'))
      }, ROOM_DOCUMENT_TIMEOUT_MS)
      const interval = setInterval(() => {
        resolveIfSynced()
      }, 50)

      if (resolveIfSynced()) {
        return
      }

      this.provider.on('synced', () => {
        resolveIfSynced()
      })
      this.provider.on('disconnect', () => {
        clearTimeout(timeout)
        clearInterval(interval)
        reject(new Error('Websocket disconnected before sync completed.'))
      })
    })

    const document = await this.waitForRoomDocument()
    this.canvasId = trimOrNull(document.activeCanvasId) || this.canvasId
    this.publishPresence()
    return this
  }

  disconnect() {
    this.clearPresence()
    this.provider?.off?.('stateless', this.boundStatelessHandler)
    for (const pending of this.pendingStatelessRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('CanvasciiAgentClient disconnected before the command completed.'))
    }
    this.pendingStatelessRequests.clear()
    this.provider?.disconnect()
    this.websocketProvider?.disconnect()
    this.provider?.destroy()
    this.doc?.destroy()
    this.provider = null
    this.websocketProvider = null
    this.doc = null
    this.root = null
  }

  async waitForRoomDocument(timeoutMs = ROOM_DOCUMENT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      try {
        const document = this.getDocument()
        if (document && typeof document === 'object') {
          return document
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Connected to the live room, but the room document is still missing. Reconnect and retry.')
  }

  handleStatelessMessage(event) {
    let payload = null
    try {
      payload = JSON.parse(event?.payload ?? '')
    } catch {
      return
    }

    if (!payload || payload.kind !== STATELESS_COMMAND_RESULT_KIND || !payload.requestId) {
      return
    }

    const pending = this.pendingStatelessRequests.get(payload.requestId)
    if (!pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingStatelessRequests.delete(payload.requestId)
    pending.resolve(payload)
  }

  requireRoot() {
    if (!this.root) {
      throw new Error('CanvasciiAgentClient is not connected.')
    }
    return this.root
  }

  getDocument() {
    const root = this.requireRoot()
    const document = root.get('document')
    if (!document || typeof document !== 'object') {
      throw new Error('Room document is missing.')
    }
    return clone(document)
  }

  listObjects(input = {}) {
    const document = this.getDocument()
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    return document.objects
      .filter((object) => object.canvasId === canvasId)
      .sort((left, right) => left.zIndex - right.zIndex)
      .map(summarizeObject)
  }

  getCanvasSnapshot(input = {}) {
    const document = this.getDocument()
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId

    return {
      revision: document.version ?? 0,
      activeCanvasId: document.activeCanvasId,
      canvasId,
      rendered: this.getRenderedText({
        canvasId,
        startRow: input.startRow,
        startCol: input.startCol,
        maxRows: input.maxRows,
        maxCols: input.maxCols,
        trim: input.trim,
        padding: input.padding,
        mode: input.mode,
      }),
      objects: this.listObjects({ canvasId }),
      collaborators: this.listCollaborators({ canvasId }),
    }
  }

  /**
   * Return a focused live read for one region: canonical JSON specs, raw objects,
   * and the rendered text for the same bounds so agents can plan bulk edits from one read.
   */
  getCanvasRegionSnapshot(input = {}) {
    const document = this.getDocument()
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const canvas = document.canvases.find((entry) => entry.id === canvasId)
    if (!canvas) {
      throw new Error(`Canvas ${canvasId} not found.`)
    }

    const region =
      Number.isInteger(input.top) &&
      Number.isInteger(input.left) &&
      Number.isInteger(input.width) &&
      Number.isInteger(input.height)
        ? {
            top: input.top,
            left: input.left,
            width: input.width,
            height: input.height,
          }
        : {
            top: canvas.bounds.top,
            left: canvas.bounds.left,
            width: canvas.bounds.width,
            height: canvas.bounds.height,
          }

    const objects = document.objects
      .filter((object) =>
        matchesObjectQuery(
          object,
          {
            intersectsTop: region.top,
            intersectsLeft: region.left,
            intersectsWidth: region.width,
            intersectsHeight: region.height,
            ...(input.type ? { type: input.type } : {}),
            ...(input.types ? { types: input.types } : {}),
          },
          canvasId,
        ),
      )
      .sort((left, right) => left.zIndex - right.zIndex)

    return {
      revision: document.version ?? 0,
      activeCanvasId: document.activeCanvasId,
      canvasId,
      region,
      objectCount: objects.length,
      objects: objects.map(summarizeObject),
      specs: objects.map(serializeObjectAsSpec),
      rendered: this.getRenderedText({
        canvasId,
        startRow: region.top,
        startCol: region.left,
        maxRows: region.height,
        maxCols: region.width,
        trim: false,
        padding: 0,
        mode: input.mode,
      }),
    }
  }

  assertExpectedRevision(expectedRevision) {
    if (!Number.isInteger(expectedRevision)) {
      return this.getDocument()
    }

    const document = this.getDocument()
    const currentRevision = document.version ?? 0
    if (currentRevision !== expectedRevision) {
      throw new Error(`Revision mismatch. Expected ${expectedRevision}, got ${currentRevision}. Re-read before mutating.`)
    }
    return document
  }

  findObjects(input = {}) {
    const document = this.getDocument()
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    return document.objects
      .filter((object) => matchesObjectQuery(object, input, canvasId))
      .sort((left, right) => left.zIndex - right.zIndex)
      .map(summarizeObject)
  }

  getRenderedText(input = {}) {
    const document = this.getDocument()
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const canvas = document.canvases.find((entry) => entry.id === canvasId)
    if (!canvas) {
      throw new Error(`Canvas ${canvasId} not found.`)
    }

    const mode = input.mode || canvas.defaultRenderMode || 'ASCII'
    const grid = createGrid(canvas.bounds.height, canvas.bounds.width)
    const objects = document.objects
      .filter((object) => object.canvasId === canvasId)
      .sort((left, right) => left.zIndex - right.zIndex)

    for (const object of objects) {
      switch (object.geometry.type) {
        case 'rectangle': {
          const chars = renderChars(mode)
          const top = Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
          const left = Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
          const bottom = Math.max(object.geometry.topLeft.row, object.geometry.bottomRight.row)
          const right = Math.max(object.geometry.topLeft.col, object.geometry.bottomRight.col)
          for (let col = left + 1; col < right; col += 1) {
            writeCell(grid, top, col, chars.horizontal)
            writeCell(grid, bottom, col, chars.horizontal)
          }
          for (let row = top + 1; row < bottom; row += 1) {
            writeCell(grid, row, left, chars.vertical)
            writeCell(grid, row, right, chars.vertical)
          }
          writeCell(grid, top, left, chars.topLeft)
          writeCell(grid, top, right, chars.topRight)
          writeCell(grid, bottom, left, chars.bottomLeft)
          writeCell(grid, bottom, right, chars.bottomRight)
          if (object.geometry.label) {
            const titleWidth = Math.max(0, right - left - 2)
            Array.from(object.geometry.label)
              .slice(0, titleWidth)
              .forEach((char, colIndex) => {
                writeCell(grid, top, left + 2 + colIndex, char)
              })
          }
          ;(object.geometry.labelLines ?? []).forEach((line, rowIndex) => {
            Array.from(line).forEach((char, colIndex) => {
              writeCell(grid, top + 1 + rowIndex, left + 1 + colIndex, char)
            })
          })
          break
        }
        case 'text':
          object.geometry.lines.forEach((line, rowIndex) => {
            Array.from(line).forEach((char, colIndex) => {
              writeCell(grid, object.geometry.start.row + rowIndex, object.geometry.start.col + colIndex, char)
            })
          })
          break
        case 'line': {
          const chars = renderChars(mode)
          const char = object.geometry.segment.axis === 'horizontal' ? chars.horizontal : chars.vertical
          if (object.geometry.segment.axis === 'horizontal') {
            const left = Math.min(object.geometry.segment.start.col, object.geometry.segment.end.col)
            const right = Math.max(object.geometry.segment.start.col, object.geometry.segment.end.col)
            for (let col = left; col <= right; col += 1) {
              writeCell(grid, object.geometry.segment.start.row, col, char)
            }
          } else {
            const top = Math.min(object.geometry.segment.start.row, object.geometry.segment.end.row)
            const bottom = Math.max(object.geometry.segment.start.row, object.geometry.segment.end.row)
            for (let row = top; row <= bottom; row += 1) {
              writeCell(grid, row, object.geometry.segment.start.col, char)
            }
          }
          break
        }
        case 'polyline': {
          const chars = renderChars(mode)
          object.geometry.segments.forEach((segment) => {
            const char = segment.axis === 'horizontal' ? chars.horizontal : chars.vertical
            if (segment.axis === 'horizontal') {
              const left = Math.min(segment.start.col, segment.end.col)
              const right = Math.max(segment.start.col, segment.end.col)
              for (let col = left; col <= right; col += 1) {
                writeCell(grid, segment.start.row, col, char)
              }
            } else {
              const top = Math.min(segment.start.row, segment.end.row)
              const bottom = Math.max(segment.start.row, segment.end.row)
              for (let row = top; row <= bottom; row += 1) {
                writeCell(grid, row, segment.start.col, char)
              }
            }
          })
          break
        }
        case 'group':
          break
      }
    }

    const hasViewport = Number.isInteger(input.startRow) || Number.isInteger(input.startCol)
    const trimmed =
      hasViewport
        ? {
            offsetRow: Math.max(0, input.startRow ?? 0),
            offsetCol: Math.max(0, input.startCol ?? 0),
            grid: grid
              .slice(Math.max(0, input.startRow ?? 0))
              .map((row) => row.slice(Math.max(0, input.startCol ?? 0))),
          }
        : input.trim === false
          ? { offsetRow: 0, offsetCol: 0, grid }
          : trimGrid(grid, input.padding ?? 1)
    const capped = trimmed.grid
      .slice(0, Number.isInteger(input.maxRows) ? input.maxRows : trimmed.grid.length)
      .map((row) => row.slice(0, Number.isInteger(input.maxCols) ? input.maxCols : row.length))
    const lines = capped.map((row) => row.join('').replace(/\s+$/, ''))

    return {
      canvasId,
      width: capped[0]?.length ?? 0,
      height: capped.length,
      offsetRow: trimmed.offsetRow,
      offsetCol: trimmed.offsetCol,
      lines,
      text: lines.join('\n'),
    }
  }

  searchText(input = {}) {
    const query = normalizeSearchQuery(input.query)
    if (!query) {
      throw new Error('query is required.')
    }

    const document = this.getDocument()
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const rendered = this.getRenderedText({
      ...input,
      canvasId,
    })
    const renderedMatches = searchRenderedLines(rendered.lines, query, input).map((match) => ({
      source: 'rendered',
      row: rendered.offsetRow + match.rowOffset,
      col: rendered.offsetCol + match.colOffset,
      match: match.match,
      line: match.line,
    }))
    const objectMatches = document.objects
      .filter((object) => object.canvasId === canvasId)
      .flatMap((object) =>
        getObjectTextLines(object).flatMap((line, rowOffset) =>
          searchRenderedLines([line], query, input).map((match) => ({
            source: 'object',
            objectId: object.id,
            objectType: object.geometry.type,
            row:
              object.geometry.type === 'text'
                ? object.geometry.start.row + rowOffset
                : object.geometry.type === 'rectangle'
                  ? Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row) + 1 + rowOffset
                  : null,
            col:
              object.geometry.type === 'text'
                ? object.geometry.start.col + match.colOffset
                : object.geometry.type === 'rectangle'
                  ? Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col) + 1 + match.colOffset
                  : null,
            match: match.match,
            line,
          })),
        ),
      )
    const dedupeKey = (entry) =>
      `${entry.source}:${entry.objectId ?? ''}:${entry.row ?? ''}:${entry.col ?? ''}:${entry.match}:${entry.line}`
    const seen = new Set()
    const matches = [...renderedMatches, ...objectMatches].filter((entry) => {
      const key = dedupeKey(entry)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return {
      query,
      canvasId,
      totalMatches: matches.length,
      matches: matches.slice(0, Number.isInteger(input.limit) ? input.limit : matches.length),
      truncated:
        Number.isInteger(input.limit) && input.limit >= 0
          ? matches.length > input.limit
          : false,
    }
  }

  listCollaborators(input = {}) {
    if (!this.provider) {
      throw new Error('CanvasciiAgentClient is not connected.')
    }

    const canvasId = trimOrNull(input.canvasId) || input.canvasId || this.canvasId
    const now = Date.now()
    return Array.from(this.provider.awareness.getStates().values())
      .map((state) => state?.presence)
      .filter(Boolean)
      .filter((presence) => isFreshPresence(presence, now))
      .map((presence) => ({
        userId: presence.userId,
        actorId: presence.actorId,
        actorType: presence.actorType || 'human',
        sessionId: presence.sessionId,
        name: presence.name,
        color: presence.color,
        access: presence.access,
        activeTool: presence.activeTool || null,
        status: presence.status || null,
        intent: presence.intent || null,
        cursor: presence.cursor,
        selection: presence.selection ?? null,
        viewport: presence.viewport ?? null,
        draft: presence.draft ?? null,
        updatedAt: presence.updatedAt ?? null,
        visibleOnCanvas: presence.cursor?.canvasId === canvasId,
      }))
  }

  findCollaborator(input = {}) {
    const actorId = trimOrNull(input.actorId)
    const sessionId = trimOrNull(input.sessionId)
    const name = trimOrNull(input.name)
    const collaborators = this.listCollaborators(input)
    return (
      collaborators.find((collaborator) =>
        (actorId && collaborator.actorId === actorId) ||
        (sessionId && collaborator.sessionId === sessionId) ||
        (name && collaborator.name === name),
      ) ?? null
    )
  }

  getCollaboratorSelection(input = {}) {
    const collaborator = this.findCollaborator(input)
    if (!collaborator?.selection) {
      return null
    }

    const document = this.getDocument()
    const objects = collaborator.selection.objectIds
      .map((objectId) => getCanvasObjectById(document, objectId))
      .filter(Boolean)
      .map((object) => summarizeObject(object))

    return {
      collaborator: {
        userId: collaborator.userId,
        actorId: collaborator.actorId,
        sessionId: collaborator.sessionId,
        name: collaborator.name,
      },
      selection: collaborator.selection,
      objects,
    }
  }

  observeCollaborators(callback, input = {}) {
    if (!this.provider) {
      throw new Error('CanvasciiAgentClient is not connected.')
    }

    const emit = () => {
      callback(this.listCollaborators(input))
    }

    this.provider.awareness.on('change', emit)
    emit()

    return () => {
      this.provider?.awareness?.off('change', emit)
    }
  }

  observeDocument(callback) {
    const root = this.requireRoot()
    const handler = () => {
      callback(this.getDocument())
    }
    root.observe(handler)
    return () => {
      root.unobserve(handler)
    }
  }

  observeCanvas(callback, input = {}) {
    let previousDocument = this.getDocument()
    let previousCollaborators = this.listCollaborators(input)

    const emit = (reason) => {
      const nextDocument = this.getDocument()
      const nextCollaborators = this.listCollaborators(input)
      const canvasId = trimOrNull(input.canvasId) || input.canvasId || nextDocument.activeCanvasId
      const previousObjects = new Map(
        previousDocument.objects
          .filter((object) => object.canvasId === canvasId)
          .map((object) => [object.id, object]),
      )
      const nextObjects = new Map(
        nextDocument.objects
          .filter((object) => object.canvasId === canvasId)
          .map((object) => [object.id, object]),
      )
      const objectIds = new Set([...previousObjects.keys(), ...nextObjects.keys()])
      const changes = []
      for (const objectId of objectIds) {
        const change = summarizeObjectChange(previousObjects.get(objectId) ?? null, nextObjects.get(objectId) ?? null)
        if (change) changes.push(change)
      }

      callback({
        reason,
        snapshot: this.getCanvasSnapshot(input),
        changes,
        collaborators: nextCollaborators,
        previousCollaborators,
      })

      previousDocument = nextDocument
      previousCollaborators = nextCollaborators
    }

    const stopDocument = this.observeDocument(() => emit('document'))
    const stopCollaborators = this.observeCollaborators(() => emit('collaborators'), input)
    emit('initial')

    return () => {
      stopDocument()
      stopCollaborators()
    }
  }

  publishPresence(input = {}) {
    if (!this.provider) return
    if (input.activeTool !== undefined) this.activeTool = trimOrNull(input.activeTool)
    if (input.intent !== undefined) this.intent = trimOrNull(input.intent)
    if (input.status !== undefined) this.status = input.status
    if (input.cursor !== undefined) this.cursor = input.cursor
    if (input.selection !== undefined) this.selection = input.selection
    if (input.viewport !== undefined) this.viewport = input.viewport
    if (input.draft !== undefined) this.draft = input.draft

    this.provider.awareness.setLocalStateField('presence', {
      userId: this.actorId,
      actorId: this.actorId,
      actorType: this.actorType,
      sessionId: this.sessionId,
      name: this.name,
      color: this.color,
      access: 'edit',
      activeTool: this.activeTool,
      status: this.status,
      intent: this.intent,
      cursor: this.cursor,
      selection: this.selection,
      viewport: this.viewport,
      draft: this.draft,
      updatedAt: new Date().toISOString(),
    })
  }

  clearPresence() {
    if (!this.provider?.awareness) return
    try {
      this.provider.awareness.setLocalState(null)
    } catch {}
  }

  setCursor(cursor, input = {}) {
    this.publishPresence({
      ...input,
      cursor,
    })
  }

  setViewport(viewport, input = {}) {
    this.publishPresence({
      ...input,
      viewport,
    })
  }

  setSelection(selection, input = {}) {
    this.publishPresence({
      ...input,
      selection,
    })
  }

  async commitCommands(commands, input = {}) {
    const root = this.requireRoot()
    const nextDocument = touchDocument(clone(input.document ?? this.getDocument()))
    commands.forEach((command) => {
      command(nextDocument)
    })

    this.doc.transact(() => {
      root.set('document', nextDocument)
    }, this.actorId)

    return clone(nextDocument)
  }

  async waitForDocumentVersion(minVersion, timeoutMs = 5_000) {
    if (!Number.isInteger(minVersion)) {
      return this.getDocument()
    }

    const current = this.getDocument()
    if ((current.version ?? 0) >= minVersion) {
      return current
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        stop()
        reject(new Error(`Timed out waiting for document version ${minVersion}.`))
      }, timeoutMs)

      const stop = this.observeDocument(() => {
        const nextDocument = this.getDocument()
        if ((nextDocument.version ?? 0) >= minVersion) {
          clearTimeout(timeout)
          stop()
          resolve(nextDocument)
        }
      })
    })
  }

  async submitCommands(commands, input = {}) {
    if (!this.provider) {
      throw new Error('CanvasciiAgentClient is not connected.')
    }
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new Error('At least one command is required.')
    }

    this.assertExpectedRevision(input.expectedRevision)

    const requestId = createRequestId()
    const payload = JSON.stringify({
      kind: STATELESS_COMMAND_REQUEST_KIND,
      requestId,
      actorId: trimOrNull(input.actorId) || this.actorId || null,
      ...(Number.isInteger(input.expectedRevision)
        ? { expectedDocumentVersion: input.expectedRevision }
        : {}),
      commands: commands.map((command) => clone(command)),
    })
    const timeoutMs = Number.isInteger(input.timeoutMs) ? input.timeoutMs : 10_000

    const resultPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingStatelessRequests.delete(requestId)
        reject(new Error(`Timed out waiting for command result ${requestId}.`))
      }, timeoutMs)

      this.pendingStatelessRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      })
    })

    this.provider.sendStateless(payload)
    const result = await resultPromise

    if (result.status === 'rejected') {
      throw new Error(result.error || 'Canvas command was rejected.')
    }
    if (result.status === 'error') {
      throw new Error(result.error || 'Canvas command failed.')
    }

    const document = await this.waitForDocumentVersion(result.documentVersion ?? null, timeoutMs)
    return {
      result,
      document,
    }
  }

  async createText(input) {
    const document = this.getDocument()
    const canvasId = input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) throw new Error(`Canvas ${canvasId} does not have a root region.`)
    this.publishPresence({
      activeTool: 'TEXT',
      status: 'editing',
      intent: 'creating text',
      cursor: { canvasId, row: input.row, col: input.col },
    })
    const at = new Date().toISOString()
    const command = buildObjectUpsertCommand(
      {
        id: createObjectId(),
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
        zIndex: getNextZIndex(document, canvasId),
        locked: false,
        createdAt: at,
        updatedAt: at,
        version: 1,
      },
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async setCanvasSize(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const canvas = getCanvasById(document, canvasId)
    const region = getCanvasRootRegion(document, canvasId)
    if (!canvas) {
      throw new Error(`Canvas ${canvasId} was not found.`)
    }
    if (!region) {
      throw new Error(`Canvas ${canvasId} does not have a root region.`)
    }

    const nextSize = clampCanvasSize(input.rows, input.cols)
    const at = new Date().toISOString()
    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `resizing canvas to ${nextSize.rows}x${nextSize.cols}`,
      cursor: { canvasId, row: 0, col: 0 },
    })

    const command = buildCanvasUpsertCommand(
      document,
      {
        canvasId,
        canvas: {
          ...canvas,
          bounds: {
            ...canvas.bounds,
            width: nextSize.cols,
            height: nextSize.rows,
          },
          updatedAt: at,
          version: (canvas.version ?? 0) + 1,
        },
        region: {
          ...region,
          rect: {
            ...region.rect,
            width: nextSize.cols,
            height: nextSize.rows,
          },
          updatedAt: at,
          version: (region.version ?? 0) + 1,
        },
      },
      this.actorId,
      at,
    )

    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async expandCanvas(input = {}) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const canvas = getCanvasById(document, canvasId)
    if (!canvas) {
      throw new Error(`Canvas ${canvasId} was not found.`)
    }

    const rows = Number.isFinite(input.rows) ? input.rows : DEFAULT_EXPAND_ROWS
    const cols = Number.isFinite(input.cols) ? input.cols : DEFAULT_EXPAND_COLS
    return this.setCanvasSize({
      canvasId,
      rows: canvas.bounds.height + Math.max(0, Math.floor(rows)),
      cols: canvas.bounds.width + Math.max(0, Math.floor(cols)),
      expectedRevision: input.expectedRevision,
    })
  }

  async shrinkCanvasToFit(input = {}) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const nextSize = getShrinkToFitCanvasSize(document, canvasId)
    return this.setCanvasSize({
      canvasId,
      rows: nextSize.rows,
      cols: nextSize.cols,
      expectedRevision: input.expectedRevision,
    })
  }

  async createRectangle(input) {
    const document = this.getDocument()
    const canvasId = input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) throw new Error(`Canvas ${canvasId} does not have a root region.`)
    this.publishPresence({
      activeTool: 'RECTANGLE',
      status: 'editing',
      intent: 'creating rectangle',
      cursor: { canvasId, row: input.top, col: input.left },
    })
    const at = new Date().toISOString()
    const command = buildObjectUpsertCommand(
      {
        id: createObjectId(),
        canvasId,
        regionId: region.id,
        type: 'rectangle',
        geometry: {
          type: 'rectangle',
          topLeft: { row: input.top, col: input.left },
          bottomRight: { row: input.top + input.height - 1, col: input.left + input.width - 1 },
          ...(input.label ? { label: input.label } : {}),
          labelLines: normalizeRectangleBodyLines(input),
        },
        content: null,
        style: buildRectangleStyle(input),
        zIndex: getNextZIndex(document, canvasId),
        locked: false,
        createdAt: at,
        updatedAt: at,
        version: 1,
      },
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async createWireframeRectangle(input) {
    return this.createRectangle({
      ...input,
      stylePreset: 'wireframe',
    })
  }

  async createLine(input) {
    const document = this.getDocument()
    const canvasId = input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) throw new Error(`Canvas ${canvasId} does not have a root region.`)
    const axis = input.from.row === input.to.row ? 'horizontal' : input.from.col === input.to.col ? 'vertical' : null
    if (!axis) throw new Error('Lines must be horizontal or vertical.')
    this.publishPresence({
      activeTool: 'LINE',
      status: 'editing',
      intent: 'creating line',
      cursor: { canvasId, row: input.to.row, col: input.to.col },
    })
    const at = new Date().toISOString()
    const command = buildObjectUpsertCommand(
      {
        id: createObjectId(),
        canvasId,
        regionId: region.id,
        type: 'line',
        geometry: {
          type: 'line',
          segment: {
            axis,
            start: clone(input.from),
            end: clone(input.to),
            direction:
              axis === 'horizontal'
                ? input.from.col <= input.to.col
                  ? 'left-to-right'
                  : 'right-to-left'
                : input.from.row <= input.to.row
                  ? 'down'
                  : 'up',
          },
        },
        content: null,
        style: input.style ?? {},
        zIndex: getNextZIndex(document, canvasId),
        locked: false,
        createdAt: at,
        updatedAt: at,
        version: 1,
      },
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async createPath(input) {
    const document = this.getDocument()
    const canvasId = input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) throw new Error(`Canvas ${canvasId} does not have a root region.`)
    const segments = input.points.slice(0, -1).map((point, index) => {
      const next = input.points[index + 1]
      const axis = point.row === next.row ? 'horizontal' : point.col === next.col ? 'vertical' : null
      if (!axis) throw new Error('Path points must form orthogonal segments.')
      return {
        axis,
        start: clone(point),
        end: clone(next),
        direction:
          axis === 'horizontal'
            ? point.col <= next.col
              ? 'left-to-right'
              : 'right-to-left'
            : point.row <= next.row
              ? 'down'
              : 'up',
      }
    })
    const lastPoint = input.points[input.points.length - 1]
    this.publishPresence({
      activeTool: 'PATH',
      status: 'editing',
      intent: 'creating path',
      cursor: { canvasId, row: lastPoint.row, col: lastPoint.col },
    })
    const at = new Date().toISOString()
    const command = buildObjectUpsertCommand(
      {
        id: createObjectId(),
        canvasId,
        regionId: region.id,
        type: 'polyline',
        geometry: {
          type: 'polyline',
          segments,
        },
        content: null,
        style: input.style ?? {},
        zIndex: getNextZIndex(document, canvasId),
        locked: false,
        createdAt: at,
        updatedAt: at,
        version: 1,
      },
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async moveObject(input) {
    const document = this.getDocument()
    const object = getCanvasObjectById(document, input.objectId)
    if (!object) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }

    let cursor = null
    switch (object.geometry.type) {
      case 'rectangle':
        cursor = {
          canvasId: object.canvasId,
          row: object.geometry.topLeft.row + input.deltaRow,
          col: object.geometry.topLeft.col + input.deltaCol,
        }
        break
      case 'text':
        cursor = {
          canvasId: object.canvasId,
          row: object.geometry.start.row + input.deltaRow,
          col: object.geometry.start.col + input.deltaCol,
        }
        break
      case 'line':
        cursor = {
          canvasId: object.canvasId,
          row: object.geometry.segment.end.row + input.deltaRow,
          col: object.geometry.segment.end.col + input.deltaCol,
        }
        break
      case 'polyline': {
        const end = object.geometry.segments[object.geometry.segments.length - 1]?.end
        cursor = end
          ? { canvasId: object.canvasId, row: end.row + input.deltaRow, col: end.col + input.deltaCol }
          : null
        break
      }
      case 'group':
        break
    }

    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `moving object ${input.objectId}`,
      cursor,
    })
    const at = new Date().toISOString()
    const command = buildObjectUpsertCommand(
      moveObjectValue(object, input.deltaRow, input.deltaCol),
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async setText(input) {
    const document = this.getDocument()
    const nextLines = input.lines ?? String(input.text ?? '').split('\n')
    const target = getCanvasObjectById(document, input.objectId)
    if (!target) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }
    this.publishPresence({
      activeTool: 'TEXT',
      status: 'editing',
      intent: `editing text ${input.objectId}`,
      cursor:
        target.geometry.type === 'text'
          ? { canvasId: target.canvasId, row: target.geometry.start.row, col: target.geometry.start.col }
          : target.geometry.type === 'rectangle'
            ? {
                canvasId: target.canvasId,
                row: Math.min(target.geometry.topLeft.row, target.geometry.bottomRight.row) + 1,
                col: Math.min(target.geometry.topLeft.col, target.geometry.bottomRight.col) + 1,
              }
            : target.geometry.type === 'line'
              ? { canvasId: target.canvasId, row: target.geometry.segment.start.row, col: target.geometry.segment.start.col }
              : target.geometry.type === 'polyline'
                ? (() => {
                    const start = target.geometry.segments[0]?.start
                    return start
                      ? { canvasId: target.canvasId, row: start.row, col: start.col }
                      : null
                  })()
                : null,
    })
    const at = new Date().toISOString()
    const nextObject =
      target.geometry.type === 'text'
        ? touchObject({
            ...target,
            geometry: {
              ...target.geometry,
              lines: [...nextLines],
            },
          })
        : target.geometry.type === 'rectangle'
          ? touchObject({
              ...target,
              geometry: {
                ...target.geometry,
                labelLines: [...nextLines],
              },
            })
          : target.geometry.type === 'line' || target.geometry.type === 'polyline'
            ? touchObject({
                ...target,
                metadata: {
                  ...(target.metadata ?? {}),
                  labelLines: [...nextLines],
                },
              })
            : null

    if (!nextObject) {
      throw new Error(`Object ${input.objectId} does not support text editing.`)
    }
    const command = buildObjectUpsertCommand(
      nextObject,
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async setRectangleLabel(input) {
    const document = this.getDocument()
    const target = getCanvasObjectById(document, input.objectId)
    if (!target) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }
    if (target.geometry.type !== 'rectangle') {
      throw new Error(`Object ${input.objectId} is not a rectangle.`)
    }

    const nextLines = input.lines ?? String(input.text ?? '').split('\n')
    const at = new Date().toISOString()
    const nextObject = touchObject({
      ...target,
      geometry: {
        ...target.geometry,
        label: nextLines.join(' ').trim(),
      },
    })
    const command = buildObjectUpsertCommand(
      nextObject,
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async setTextAlignment(input) {
    const document = this.getDocument()
    const target = getCanvasObjectById(document, input.objectId)
    if (!target) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }

    const at = new Date().toISOString()
    const nextObject =
      target.geometry.type === 'text'
        ? touchObject({
            ...target,
            geometry: {
              ...target.geometry,
              lines: alignTextLines(target.geometry.lines ?? [], input.alignment),
            },
          })
        : target.geometry.type === 'rectangle'
          ? touchObject({
              ...target,
              style: {
                ...(target.style ?? {}),
                rectangleTextAlignH: input.alignment,
              },
            })
          : null

    if (!nextObject) {
      throw new Error(`Object ${input.objectId} does not support text alignment.`)
    }

    const command = buildObjectUpsertCommand(nextObject, this.actorId, at)
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async encloseText(input) {
    const document = this.getDocument()
    const target = getCanvasObjectById(document, input.objectId)
    if (!target) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }
    if (target.geometry.type !== 'text') {
      throw new Error(`Object ${input.objectId} is not a text object.`)
    }
    const lines = target.geometry.lines ?? []
    if (lines.length === 0 || lines.every((line) => String(line ?? '').trim().length === 0)) {
      throw new Error(`Object ${input.objectId} is empty.`)
    }

    const padding = Math.max(0, Number.isFinite(input.padding) ? Math.floor(input.padding) : 1)
    const longestLineLength = Math.max(1, ...lines.map((line) => Array.from(line).length))
    const at = new Date().toISOString()
    const nextObject = touchObject({
      ...target,
      type: 'rectangle',
      geometry: {
        type: 'rectangle',
        topLeft: {
          row: target.geometry.start.row - padding,
          col: target.geometry.start.col - padding,
        },
        bottomRight: {
          row: target.geometry.start.row + lines.length - 1 + padding,
          col: target.geometry.start.col + longestLineLength - 1 + padding,
        },
        labelLines: [...lines],
      },
      content: null,
      style: buildRectangleStyle({ stylePreset: 'wireframe' }),
    })

    const command = buildObjectUpsertCommand(nextObject, this.actorId, at)
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async resizeObject(input) {
    const document = this.getDocument()
    const object = getCanvasObjectById(document, input.objectId)
    if (!object) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }
    if (object.geometry.type !== 'rectangle') {
      throw new Error(`Object ${input.objectId} does not support resize.`)
    }

    const top = input.top ?? Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
    const left = input.left ?? Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
    const width =
      input.width ??
      Math.abs(object.geometry.bottomRight.col - object.geometry.topLeft.col) + 1
    const height =
      input.height ??
      Math.abs(object.geometry.bottomRight.row - object.geometry.topLeft.row) + 1
    const at = new Date().toISOString()

    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `resizing object ${input.objectId}`,
      cursor: { canvasId: object.canvasId, row: top, col: left },
    })

    const command = buildObjectUpsertCommand(
      touchObject({
        ...object,
        geometry: {
          ...object.geometry,
          topLeft: { row: top, col: left },
          bottomRight: { row: top + height - 1, col: left + width - 1 },
        },
      }),
      this.actorId,
      at,
    )
    const { document: nextDocument } = await this.submitCommands([command], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async deleteObject(input) {
    const document = this.getDocument()
    const object = getCanvasObjectById(document, input.objectId)
    if (!object) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }

    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `deleting object ${input.objectId}`,
      cursor: null,
    })

    const { document: nextDocument } = await this.submitCommands([
      buildObjectDeleteCommand(input.objectId, this.actorId, new Date().toISOString()),
    ], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async streamText(input) {
    this.assertExpectedRevision(input.expectedRevision)
    const delayMs = Number.isInteger(input.delayMs) ? input.delayMs : 80
    const mode = input.chunkMode === 'word' ? 'word' : 'char'
    const chunks =
      mode === 'word'
        ? String(input.text).match(/\S+\s*|\s+/g) ?? [String(input.text)]
        : Array.from(String(input.text))

    await this.setText({
      objectId: input.objectId,
      lines: input.clearFirst ? [''] : input.prefix ? [input.prefix] : [''],
    })

    let current = input.clearFirst ? '' : input.prefix ?? ''
    const document = this.getDocument()
    const target = getCanvasObjectById(document, input.objectId)
    const start = target?.geometry.type === 'text' ? target.geometry.start : null

    for (let index = 0; index < chunks.length; index += 1) {
      current += chunks[index]
      this.publishPresence({
        activeTool: 'TEXT',
        status: 'streaming',
        intent: `streaming text ${input.objectId}`,
        cursor:
          start
            ? {
                canvasId: target.canvasId,
                row: start.row,
                col: start.col + Math.max(0, Array.from(current).length - 1),
              }
            : null,
      })
      await this.setText({
        objectId: input.objectId,
        text: current,
      })
      if (index < chunks.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    this.publishPresence({
      status: 'idle',
      intent: 'finished typing',
    })

    return this.getDocument()
  }

  async deleteObjectsByQuery(input = {}) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const objects = document.objects
      .filter((object) => matchesObjectQuery(object, input, canvasId))
      .sort((left, right) => left.zIndex - right.zIndex)

    if (objects.length === 0) {
      return {
        document,
        deletedObjectIds: [],
      }
    }

    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `deleting ${objects.length} object${objects.length === 1 ? '' : 's'}`,
      cursor: null,
    })

    const at = new Date().toISOString()
    const { document: nextDocument } = await this.submitCommands(
      objects.map((object) => buildObjectDeleteCommand(object.id, this.actorId, at)),
      {
        expectedRevision: input.expectedRevision,
      },
    )

    return {
      document: nextDocument,
      deletedObjectIds: objects.map((object) => object.id),
    }
  }

  async clearRegion(input) {
    return this.deleteObjectsByQuery({
      canvasId: input.canvasId,
      expectedRevision: input.expectedRevision,
      intersectsTop: input.top,
      intersectsLeft: input.left,
      intersectsWidth: input.width,
      intersectsHeight: input.height,
      type: input.type,
      types: input.types,
      labelContains: input.labelContains,
      textContains: input.textContains,
      caseSensitive: input.caseSensitive,
    })
  }

  async replaceRegion(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) {
      throw new Error(`Canvas ${canvasId} does not have a root region.`)
    }

    const toDelete = document.objects
      .filter((object) =>
        matchesObjectQuery(
          object,
          {
            intersectsTop: input.top,
            intersectsLeft: input.left,
            intersectsWidth: input.width,
            intersectsHeight: input.height,
            ...(input.clearTypes ? { types: input.clearTypes } : {}),
            ...(input.labelContains ? { labelContains: input.labelContains } : {}),
            ...(input.textContains ? { textContains: input.textContains } : {}),
            ...(input.caseSensitive ? { caseSensitive: true } : {}),
          },
          canvasId,
        ),
      )
      .sort((left, right) => left.zIndex - right.zIndex)

    const at = new Date().toISOString()
    let nextZIndex = getNextZIndex(document, canvasId)
    const createCommands = (input.objects ?? []).map((spec) => {
      const command = buildObjectUpsertFromSpec(spec, {
        canvasId,
        regionId: region.id,
        actorId: this.actorId,
        zIndex: nextZIndex,
        at,
      })
      nextZIndex += 1
      return command
    })

    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `replacing region ${input.top},${input.left},${input.width}x${input.height}`,
      cursor: { canvasId, row: input.top, col: input.left },
    })

    const commands = [
      ...toDelete.map((object) => buildObjectDeleteCommand(object.id, this.actorId, at)),
      ...createCommands,
    ]

    if (commands.length === 0) {
      return {
        document,
        deletedObjectIds: [],
        upsertedObjectIds: [],
      }
    }

    const { document: nextDocument } = await this.submitCommands(commands, {
      expectedRevision: input.expectedRevision,
    })

    return {
      document: nextDocument,
      deletedObjectIds: toDelete.map((object) => object.id),
      upsertedObjectIds: createCommands.map((command) => command.input.object.id),
    }
  }

  /**
   * Apply a batch of object specs in one room command submission so agents can
   * render or patch a mockup in a single round-trip.
   */
  async upsertObjects(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) {
      throw new Error(`Canvas ${canvasId} does not have a root region.`)
    }

    const specs = Array.isArray(input.objects) ? input.objects : []
    if (specs.length === 0) {
      return { document, upsertedObjectIds: [] }
    }

    const byId = new Map(document.objects.map((object) => [object.id, object]))
    const at = new Date().toISOString()
    let nextZIndex = getNextZIndex(document, canvasId)
    const commands = specs.map((spec) => {
      const existingObject = spec.id ? byId.get(spec.id) ?? null : null
      const command = buildObjectUpsertFromSpec(spec, {
        canvasId,
        regionId: region.id,
        actorId: this.actorId,
        zIndex: existingObject?.zIndex ?? nextZIndex,
        at,
        existingObject,
      })
      if (!existingObject) {
        nextZIndex += 1
      }
      return command
    })

    const anchor = specs[0]
    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `upserting ${specs.length} objects`,
      cursor:
        anchor && typeof anchor === 'object'
          ? {
              canvasId,
              row: anchor.row ?? anchor.top ?? anchor.from?.row ?? anchor.points?.[0]?.row ?? region.top,
              col: anchor.col ?? anchor.left ?? anchor.from?.col ?? anchor.points?.[0]?.col ?? region.left,
            }
          : { canvasId, row: region.top, col: region.left },
    })

    const { document: nextDocument } = await this.submitCommands(commands, {
      expectedRevision: input.expectedRevision,
    })

    return {
      document: nextDocument,
      upsertedObjectIds: commands.map((command) => command.input.object.id),
    }
  }

  /**
   * Apply a full JSON drawing payload using either merge/upsert semantics or a
   * region replacement, depending on the caller's intent.
   */
  async applyCanvasJson(input) {
    const mode = input.mode === 'replace-region' ? 'replace-region' : 'upsert'
    if (mode === 'replace-region') {
      const result = await this.replaceRegion(input)
      return {
        mode,
        document: result.document,
        upsertedObjectIds: result.upsertedObjectIds,
        deletedObjectIds: result.deletedObjectIds,
      }
    }

    const result = await this.upsertObjects(input)
    return {
      mode,
      document: result.document,
      upsertedObjectIds: result.upsertedObjectIds,
      deletedObjectIds: [],
    }
  }

  /**
   * Move several live objects together in one command batch so agents can treat
   * a set of shapes like a single group transform.
   */
  async moveObjects(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const objectIds = Array.isArray(input.objectIds) ? [...new Set(input.objectIds.filter(Boolean))] : []
    if (objectIds.length === 0) {
      throw new Error('At least one object id is required.')
    }

    const objects = objectIds.map((objectId) => {
      const object = getCanvasObjectById(document, objectId)
      if (!object) {
        throw new Error(`Object ${objectId} was not found.`)
      }
      return object
    })

    const deltaRow = Number.isInteger(input.deltaRow) ? input.deltaRow : 0
    const deltaCol = Number.isInteger(input.deltaCol) ? input.deltaCol : 0
    const at = new Date().toISOString()
    const commands = objects.map((object) =>
      buildObjectUpsertCommand(moveObjectValue(object, deltaRow, deltaCol), this.actorId, at),
    )

    const firstObject = objects[0]
    const firstBounds = getObjectBounds(firstObject)
    this.publishPresence({
      activeTool: 'SELECT',
      status: 'editing',
      intent: `moving ${objects.length} objects`,
      cursor: firstBounds
        ? { canvasId: firstObject.canvasId, row: firstBounds.top + deltaRow, col: firstBounds.left + deltaCol }
        : null,
    })

    const { document: nextDocument } = await this.submitCommands(commands, {
      expectedRevision: input.expectedRevision,
    })

    return {
      document: nextDocument,
      movedObjectIds: objectIds,
    }
  }

  async replaceObjects(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const canvasId = trimOrNull(input.canvasId) || input.canvasId || document.activeCanvasId
    const region = getCanvasRootRegion(document, canvasId)
    if (!region) {
      throw new Error(`Canvas ${canvasId} does not have a root region.`)
    }
    const objectIds = Array.isArray(input.objectIds) ? [...new Set(input.objectIds.filter(Boolean))] : []
    const specs = Array.isArray(input.objects) ? input.objects : []
    const at = new Date().toISOString()
    let nextZIndex = getNextZIndex(document, canvasId)
    const commands = [
      ...objectIds.map((objectId) => buildObjectDeleteCommand(objectId, this.actorId, at)),
      ...specs.map((spec) => {
        const command = buildObjectUpsertFromSpec(spec, {
          canvasId,
          regionId: region.id,
          actorId: this.actorId,
          zIndex: nextZIndex,
          at,
        })
        nextZIndex += 1
        return command
      }),
    ]
    if (commands.length === 0) {
      return { document, deletedObjectIds: [], upsertedObjectIds: [] }
    }
    const { document: nextDocument } = await this.submitCommands(commands, {
      expectedRevision: input.expectedRevision,
    })
    return {
      document: nextDocument,
      deletedObjectIds: objectIds,
      upsertedObjectIds: commands.filter((command) => command.type === 'object.upsert').map((command) => command.input.object.id),
    }
  }

  async patchObject(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const object = getCanvasObjectById(document, input.objectId)
    if (!object) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }
    const nextObject = patchObjectValue(object, input)
    const { document: nextDocument } = await this.submitCommands([
      buildObjectUpsertCommand(nextObject, this.actorId, new Date().toISOString()),
    ], {
      expectedRevision: input.expectedRevision,
    })
    return nextDocument
  }

  async alignObjects(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const objectIds = Array.isArray(input.objectIds) ? [...new Set(input.objectIds.filter(Boolean))] : []
    if (objectIds.length === 0) {
      throw new Error('At least one object id is required.')
    }
    const objects = objectIds.map((objectId) => {
      const object = getCanvasObjectById(document, objectId)
      if (!object) {
        throw new Error(`Object ${objectId} was not found.`)
      }
      return object
    })
    const bounds = objects.map((object) => getObjectBounds(object))
    if (bounds.some((entry) => !entry)) {
      throw new Error('One or more objects do not support alignment.')
    }
    const reference = {
      top: Math.min(...bounds.map((entry) => entry.top)),
      left: Math.min(...bounds.map((entry) => entry.left)),
      right: Math.max(...bounds.map((entry) => entry.right)),
      bottom: Math.max(...bounds.map((entry) => entry.bottom)),
    }
    reference.centerX = Math.round((reference.left + reference.right) / 2)
    reference.centerY = Math.round((reference.top + reference.bottom) / 2)
    const at = new Date().toISOString()
    const commands = objects.map((object) =>
      buildObjectUpsertCommand(alignObjectValue(object, input.edge, reference), this.actorId, at),
    )
    const { document: nextDocument } = await this.submitCommands(commands, {
      expectedRevision: input.expectedRevision,
    })
    return {
      document: nextDocument,
      objectIds,
    }
  }

  async packObjects(input) {
    const document = this.assertExpectedRevision(input.expectedRevision)
    const objectIds = Array.isArray(input.objectIds) ? [...new Set(input.objectIds.filter(Boolean))] : []
    if (objectIds.length === 0) {
      throw new Error('At least one object id is required.')
    }
    const objects = objectIds.map((objectId) => {
      const object = getCanvasObjectById(document, objectId)
      if (!object) {
        throw new Error(`Object ${objectId} was not found.`)
      }
      return object
    })
    const packed = packObjectValues(
      objects,
      input.axis === 'horizontal' ? 'horizontal' : 'vertical',
      normalizeStackGap(input.gap),
      input.align === 'center' || input.align === 'end' ? input.align : 'start',
    )
    const at = new Date().toISOString()
    const commands = packed.map((object) => buildObjectUpsertCommand(object, this.actorId, at))
    const { document: nextDocument } = await this.submitCommands(commands, {
      expectedRevision: input.expectedRevision,
    })
    return {
      document: nextDocument,
      objectIds,
    }
  }

  async streamRectangleLabel(input) {
    const document = this.getDocument()
    const target = getCanvasObjectById(document, input.objectId)
    if (!target) {
      throw new Error(`Object ${input.objectId} was not found.`)
    }
    if (target.geometry.type !== 'rectangle') {
      throw new Error(`Object ${input.objectId} is not a rectangle.`)
    }

    return this.streamText(input)
  }
}
