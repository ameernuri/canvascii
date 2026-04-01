import type { CanvasPortal, CanvasShareGrant, CanvasSharePolicy } from '@canvascii/core'
import type { AppState, Diagram } from '@/components/asciip-core/store/appSlice'
import type { ShapeObject } from '@/components/asciip-core/store/diagramSlice'
import { initDiagramData } from '@/components/asciip-core/store/diagramSlice'
import { getBoundingBox } from '@/components/asciip-core/models/shapeInCanvas'
import { translateUnbounded } from '@/components/asciip-core/models/transformation'
import type { Shape } from '@/components/asciip-core/models/shapes'

function createRuntimeUuid() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export type CanvasAgentAction =
  | {
      type: 'upsert_objects'
      canvasId?: string
      objects: CanvasAgentObjectSpec[]
    }
  | {
      type: 'move_objects'
      canvasId?: string
      objectIds: string[]
      deltaRow: number
      deltaCol: number
    }
  | {
      type: 'delete_objects'
      canvasId?: string
      objectIds: string[]
    }
  | {
      type: 'replace_objects'
      canvasId?: string
      objectIds: string[]
      objects: CanvasAgentObjectSpec[]
    }
  | {
      type: 'patch_object'
      canvasId?: string
      objectId: string
      top?: number
      left?: number
      width?: number
      height?: number
      row?: number
      col?: number
      title?: string
      text?: string
      body?: string
      alignment?: 'LEFT' | 'CENTER' | 'RIGHT'
    }
  | {
      type: 'pack_objects'
      canvasId?: string
      objectIds: string[]
      axis: 'vertical' | 'horizontal'
      gap: number
      align: 'start' | 'center' | 'end'
    }
  | {
      type: 'align_objects'
      canvasId?: string
      objectIds: string[]
      edge: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'
    }
  | {
      type: 'replace_region'
      canvasId?: string
      top: number
      left: number
      width: number
      height: number
      clearTypes?: CanvasAgentObjectSpec['type'][]
      objects: CanvasAgentObjectSpec[]
    }
  | {
      type: 'set_canvas_size'
      canvasId?: string
      rows: number
      cols: number
    }
  | {
      type: 'expand_canvas'
      canvasId?: string
      rows?: number
      cols?: number
    }
  | {
      type: 'shrink_canvas_to_fit'
      canvasId?: string
    }
  | {
      type: 'create_rectangle'
      canvasId?: string
      top: number
      left: number
      width: number
      height: number
      label?: string
      labelLines?: string[]
    }
  | {
      type: 'move_object'
      canvasId?: string
      objectId: string
      top?: number
      left?: number
      deltaRow?: number
      deltaCol?: number
    }
  | {
      type: 'resize_object'
      canvasId?: string
      objectId: string
      top?: number
      left?: number
      width?: number
      height?: number
    }
  | {
      type: 'delete_object'
      canvasId?: string
      objectId: string
    }
  | {
      type: 'set_text'
      canvasId?: string
      objectId: string
      lines: string[]
    }
  | {
      type: 'set_rectangle_label'
      canvasId?: string
      objectId: string
      label: string
    }
  | {
      type: 'set_text_alignment'
      canvasId?: string
      objectId: string
      alignment: 'LEFT' | 'CENTER' | 'RIGHT'
    }
  | {
      type: 'enclose_text'
      canvasId?: string
      objectId: string
      padding?: number
    }
  | {
      type: 'create_text'
      canvasId?: string
      row: number
      col: number
      lines: string[]
    }
  | {
      type: 'create_line'
      canvasId?: string
      from: {
        row: number
        col: number
      }
      to: {
        row: number
        col: number
      }
    }
  | {
      type: 'add_portal'
      canvasId?: string
      label: string
      top: number
      left: number
      width: number
      height: number
      color?: string
    }
  | {
      type: 'update_portal'
      portalId: string
      top?: number
      left?: number
      width?: number
      height?: number
      label?: string
      color?: string
      moveContents?: boolean
    }
  | {
      type: 'delete_portal'
      portalId: string
    }
  | {
      type: 'share_canvas'
      email: string
      access: 'view' | 'edit'
    }
  | {
      type: 'share_canvas_link'
      token: string
      access: 'view' | 'edit'
    }
  | {
      type: 'unshare_canvas_link'
      token: string
    }
  | {
      type: 'share_portal'
      portalId: string
      email: string
      access: 'view' | 'edit'
      allowCanvasView?: boolean
    }
  | {
      type: 'share_portal_link'
      portalId: string
      token: string
      access: 'view' | 'edit'
      allowCanvasView?: boolean
    }
  | {
      type: 'unshare_portal_link'
      portalId: string
      token: string
    }
  | {
      type: 'update_grant'
      grantId: string
      access: 'view' | 'edit'
      allowCanvasView?: boolean
    }
  | {
      type: 'revoke_grant'
      grantId: string
      revokeCompanionCanvasGrant?: boolean
    }

export type CanvasAgentObjectSpec =
  | {
      id?: string
      type: 'rectangle'
      top: number
      left: number
      width: number
      height: number
      label?: string
      body?: string
      bodyLines?: string[]
      labelLines?: string[]
      style?: ShapeObject['style']
    }
  | {
      id?: string
      type: 'text'
      row: number
      col: number
      text?: string
      lines?: string[]
      style?: ShapeObject['style']
    }
  | {
      id?: string
      type: 'line'
      from: { row: number; col: number }
      to: { row: number; col: number }
      labelLines?: string[]
      style?: ShapeObject['style']
    }
  | {
      id?: string
      type: 'path'
      points: { row: number; col: number }[]
      labelLines?: string[]
      style?: ShapeObject['style']
    }

function getCanvasId(state: AppState, requestedCanvasId?: string): string {
  return requestedCanvasId ?? state.activeDiagramId
}

function createShapeObjectId() {
  return createRuntimeUuid()
}

function updateDiagram(state: AppState, canvasId: string, updater: (diagram: Diagram) => Diagram): AppState {
  return {
    ...state,
    diagrams: state.diagrams.map((diagram) => (diagram.id === canvasId ? updater(diagram) : diagram)),
  }
}

const DEFAULT_AGENT_CANVAS_SIZE = initDiagramData().canvasSize
const DEFAULT_EXPAND_ROWS = 40
const DEFAULT_EXPAND_COLS = 125

function getDiagramContentBounds(diagram: Diagram) {
  const shapeBounds = diagram.data.shapes
    .map((shapeObject) => getBoundingBox(shapeObject.shape))
    .filter(Boolean)

  const portalBounds = diagram.data.portalViews.map((portal) => ({
    top: portal.rect.top,
    left: portal.rect.left,
    bottom: portal.rect.top + portal.rect.height - 1,
    right: portal.rect.left + portal.rect.width - 1,
  }))

  const allBounds = [...shapeBounds, ...portalBounds]
  if (allBounds.length === 0) {
    return null
  }

  return allBounds.reduce(
    (combined, bounds) => ({
      top: Math.min(combined.top, bounds.top),
      left: Math.min(combined.left, bounds.left),
      bottom: Math.max(combined.bottom, bounds.bottom),
      right: Math.max(combined.right, bounds.right),
    }),
    allBounds[0]!,
  )
}

function clampCanvasSize(rows: number, cols: number) {
  return {
    rows: Math.max(1, Math.floor(rows)),
    cols: Math.max(1, Math.floor(cols)),
  }
}

function getShrinkToFitCanvasSize(diagram: Diagram) {
  const bounds = getDiagramContentBounds(diagram)
  if (!bounds) {
    return {
      rows: Math.min(diagram.data.canvasSize.rows, DEFAULT_AGENT_CANVAS_SIZE.rows),
      cols: Math.min(diagram.data.canvasSize.cols, DEFAULT_AGENT_CANVAS_SIZE.cols),
    }
  }

  return clampCanvasSize(bounds.bottom + 1, bounds.right + 1)
}

/**
 * Re-pad plain text lines so a later render reads as left, center, or right aligned.
 * We trim first so repeated alignment commands do not accumulate extra whitespace forever.
 */
function alignTextLines(lines: string[], alignment: 'LEFT' | 'CENTER' | 'RIGHT') {
  const trimmedLines = lines.map((line) => line.trim())
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

/**
 * Use a single anchor per shape kind so "move to row/col" commands have one obvious meaning.
 * Rectangles use top-left, text uses start, and line-like shapes use their first point.
 */
function getShapeAnchor(shape: Shape) {
  switch (shape.type) {
    case 'RECTANGLE':
      return { r: shape.tl.r, c: shape.tl.c }
    case 'TEXT':
      return { r: shape.start.r, c: shape.start.c }
    case 'LINE':
      return { r: shape.start.r, c: shape.start.c }
    case 'MULTI_SEGMENT_LINE':
      return shape.segments[0]?.start ?? { r: 0, c: 0 }
  }
}

function normalizeSpecTextLines(spec: Extract<CanvasAgentObjectSpec, { type: 'text' }>) {
  return spec.lines ?? String(spec.text ?? '').split('\n')
}

/**
 * `labelLines` is a legacy internal field name. Agents should think in terms of
 * box border `label` plus box body `body` / `bodyLines`.
 */
function normalizeRectangleBodyLines(
  spec: Extract<CanvasAgentObjectSpec, { type: 'rectangle' }>,
) {
  return spec.bodyLines ?? (typeof spec.body === 'string' ? spec.body.split('\n') : undefined) ?? spec.labelLines ?? []
}

function buildSegmentDirection(
  start: { row: number; col: number },
  end: { row: number; col: number },
) {
  if (start.row === end.row) {
    return start.col > end.col ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT'
  }
  return start.row > end.row ? 'UP' : 'DOWN'
}

function buildShapeObjectFromSpec(spec: CanvasAgentObjectSpec, existing?: ShapeObject | null): ShapeObject {
  const id = spec.id ?? existing?.id ?? createShapeObjectId()
  switch (spec.type) {
    case 'rectangle':
      return {
        ...(existing ?? {}),
        id,
        style: spec.style ?? existing?.style,
        shape: {
          type: 'RECTANGLE',
          tl: { r: spec.top, c: spec.left },
          br: { r: spec.top + spec.height - 1, c: spec.left + spec.width - 1 },
          label: spec.label,
          labelLines: normalizeRectangleBodyLines(spec),
        },
      }
    case 'text':
      return {
        ...(existing ?? {}),
        id,
        style: spec.style ?? existing?.style,
        shape: {
          type: 'TEXT',
          start: { r: spec.row, c: spec.col },
          lines: normalizeSpecTextLines(spec),
        },
      }
    case 'line': {
      const axis = spec.from.row === spec.to.row ? 'HORIZONTAL' : 'VERTICAL'
      if (axis === 'HORIZONTAL') {
        return {
          ...(existing ?? {}),
          id,
          style: spec.style ?? existing?.style,
          shape: {
            type: 'LINE',
            axis: 'HORIZONTAL',
            start: { r: spec.from.row, c: spec.from.col },
            end: { r: spec.to.row, c: spec.to.col },
            direction: spec.from.col > spec.to.col ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT',
            ...(spec.labelLines ? { labelLines: [...spec.labelLines] } : {}),
          },
        }
      }
      return {
        ...(existing ?? {}),
        id,
        style: spec.style ?? existing?.style,
        shape: {
          type: 'LINE',
          axis: 'VERTICAL',
          start: { r: spec.from.row, c: spec.from.col },
          end: { r: spec.to.row, c: spec.to.col },
          direction: spec.from.row > spec.to.row ? 'UP' : 'DOWN',
          ...(spec.labelLines ? { labelLines: [...spec.labelLines] } : {}),
        },
      }
    }
    case 'path':
      return {
        ...(existing ?? {}),
        id,
        style: spec.style ?? existing?.style,
        shape: {
          type: 'MULTI_SEGMENT_LINE',
          segments: spec.points.slice(0, -1).map((point, index) => {
            const next = spec.points[index + 1]
            if (point.row === next.row) {
              return {
                axis: 'HORIZONTAL' as const,
                start: { r: point.row, c: point.col },
                end: { r: next.row, c: next.col },
                direction: point.col > next.col ? 'RIGHT_TO_LEFT' as const : 'LEFT_TO_RIGHT' as const,
              }
            }
            return {
              axis: 'VERTICAL' as const,
              start: { r: point.row, c: point.col },
              end: { r: next.row, c: next.col },
              direction: point.row > next.row ? 'UP' as const : 'DOWN' as const,
            }
          }),
          ...(spec.labelLines ? { labelLines: [...spec.labelLines] } : {}),
        },
      }
  }
}

export function serializeShapeObjectAsAgentSpec(shapeObject: ShapeObject): CanvasAgentObjectSpec {
  switch (shapeObject.shape.type) {
    case 'RECTANGLE':
      return {
        id: shapeObject.id,
        type: 'rectangle',
        top: shapeObject.shape.tl.r,
        left: shapeObject.shape.tl.c,
        width: shapeObject.shape.br.c - shapeObject.shape.tl.c + 1,
        height: shapeObject.shape.br.r - shapeObject.shape.tl.r + 1,
        ...(shapeObject.shape.label ? { label: shapeObject.shape.label } : {}),
        ...(shapeObject.shape.labelLines ? { bodyLines: [...shapeObject.shape.labelLines] } : {}),
        ...(shapeObject.style ? { style: shapeObject.style } : {}),
      }
    case 'TEXT':
      return {
        id: shapeObject.id,
        type: 'text',
        row: shapeObject.shape.start.r,
        col: shapeObject.shape.start.c,
        lines: [...shapeObject.shape.lines],
        ...(shapeObject.style ? { style: shapeObject.style } : {}),
      }
    case 'LINE':
      return {
        id: shapeObject.id,
        type: 'line',
        from: { row: shapeObject.shape.start.r, col: shapeObject.shape.start.c },
        to: { row: shapeObject.shape.end.r, col: shapeObject.shape.end.c },
        ...(shapeObject.shape.labelLines ? { labelLines: [...shapeObject.shape.labelLines] } : {}),
        ...(shapeObject.style ? { style: shapeObject.style } : {}),
      }
    case 'MULTI_SEGMENT_LINE': {
      const points =
        shapeObject.shape.segments.length > 0
          ? [
              { row: shapeObject.shape.segments[0].start.r, col: shapeObject.shape.segments[0].start.c },
              ...shapeObject.shape.segments.map((segment) => ({ row: segment.end.r, col: segment.end.c })),
            ]
          : []
      return {
        id: shapeObject.id,
        type: 'path',
        points,
        ...(shapeObject.shape.labelLines ? { labelLines: [...shapeObject.shape.labelLines] } : {}),
        ...(shapeObject.style ? { style: shapeObject.style } : {}),
      }
    }
  }
}

function shapeObjectMatchesAgentType(shapeObject: ShapeObject, type: CanvasAgentObjectSpec['type']) {
  return (
    (type === 'rectangle' && shapeObject.shape.type === 'RECTANGLE') ||
    (type === 'text' && shapeObject.shape.type === 'TEXT') ||
    (type === 'line' && shapeObject.shape.type === 'LINE') ||
    (type === 'path' && shapeObject.shape.type === 'MULTI_SEGMENT_LINE')
  )
}

function getSpecBounds(spec: CanvasAgentObjectSpec) {
  switch (spec.type) {
    case 'rectangle':
      return {
        top: spec.top,
        left: spec.left,
        width: spec.width,
        height: spec.height,
        right: spec.left + spec.width - 1,
        bottom: spec.top + spec.height - 1,
      }
    case 'text': {
      const lines = spec.lines ?? (typeof spec.text === 'string' ? spec.text.split('\n') : [''])
      const width = Math.max(1, ...lines.map((line) => Array.from(line).length))
      return {
        top: spec.row,
        left: spec.col,
        width,
        height: Math.max(1, lines.length),
        right: spec.col + width - 1,
        bottom: spec.row + Math.max(1, lines.length) - 1,
      }
    }
    case 'line': {
      const top = Math.min(spec.from.row, spec.to.row)
      const left = Math.min(spec.from.col, spec.to.col)
      const right = Math.max(spec.from.col, spec.to.col)
      const bottom = Math.max(spec.from.row, spec.to.row)
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
        right,
        bottom,
      }
    }
    case 'path': {
      const top = Math.min(...spec.points.map((point) => point.row))
      const left = Math.min(...spec.points.map((point) => point.col))
      const right = Math.max(...spec.points.map((point) => point.col))
      const bottom = Math.max(...spec.points.map((point) => point.row))
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
        right,
        bottom,
      }
    }
  }
}

function translateSpec(spec: CanvasAgentObjectSpec, deltaRow: number, deltaCol: number): CanvasAgentObjectSpec {
  switch (spec.type) {
    case 'rectangle':
      return { ...spec, top: spec.top + deltaRow, left: spec.left + deltaCol }
    case 'text':
      return { ...spec, row: spec.row + deltaRow, col: spec.col + deltaCol }
    case 'line':
      return {
        ...spec,
        from: { row: spec.from.row + deltaRow, col: spec.from.col + deltaCol },
        to: { row: spec.to.row + deltaRow, col: spec.to.col + deltaCol },
      }
    case 'path':
      return {
        ...spec,
        points: spec.points.map((point) => ({ row: point.row + deltaRow, col: point.col + deltaCol })),
      }
  }
}

function patchSpec(spec: CanvasAgentObjectSpec, patch: Extract<CanvasAgentAction, { type: 'patch_object' }>): CanvasAgentObjectSpec {
  switch (spec.type) {
    case 'rectangle': {
      const top = patch.top ?? spec.top
      const left = patch.left ?? spec.left
      const width = patch.width ?? spec.width
      const height = patch.height ?? spec.height
      const nextStyle = patch.alignment
        ? {
            ...(spec.style ?? {}),
            rectangleTextAlignH: patch.alignment,
          }
        : spec.style
      return {
        ...spec,
        top,
        left,
        width,
        height,
        ...(patch.title != null ? { label: patch.title } : {}),
        ...(patch.body != null
          ? { bodyLines: patch.body.split('\n') }
          : patch.text != null
            ? { bodyLines: patch.text.split('\n') }
            : {}),
        ...(nextStyle ? { style: nextStyle } : {}),
      }
    }
    case 'text': {
      const next = {
        ...spec,
        row: patch.row ?? patch.top ?? spec.row,
        col: patch.col ?? patch.left ?? spec.col,
      }
      if (patch.text != null || patch.body != null) {
        next.lines = (patch.text ?? patch.body ?? '').split('\n')
      }
      if (patch.alignment) {
        next.lines = alignTextLines(next.lines ?? [], patch.alignment)
      }
      return next
    }
    case 'line':
      return patch.text != null || patch.body != null
        ? { ...spec, labelLines: (patch.text ?? patch.body ?? '').split('\n') }
        : spec
    case 'path':
      return patch.text != null || patch.body != null
        ? { ...spec, labelLines: (patch.text ?? patch.body ?? '').split('\n') }
        : spec
  }
}

function alignSpecs(specs: CanvasAgentObjectSpec[], edge: Extract<CanvasAgentAction, { type: 'align_objects' }>['edge']) {
  if (specs.length === 0) return specs
  const bounds = specs.map(getSpecBounds)
  const minLeft = Math.min(...bounds.map((entry) => entry.left))
  const maxRight = Math.max(...bounds.map((entry) => entry.right))
  const minTop = Math.min(...bounds.map((entry) => entry.top))
  const maxBottom = Math.max(...bounds.map((entry) => entry.bottom))
  const centerX = Math.round((minLeft + maxRight) / 2)
  const centerY = Math.round((minTop + maxBottom) / 2)

  return specs.map((spec, index) => {
    const entry = bounds[index]!
    let nextTop = entry.top
    let nextLeft = entry.left
    if (edge === 'left') nextLeft = minLeft
    if (edge === 'right') nextLeft = maxRight - entry.width + 1
    if (edge === 'top') nextTop = minTop
    if (edge === 'bottom') nextTop = maxBottom - entry.height + 1
    if (edge === 'hcenter') nextLeft = centerX - Math.floor(entry.width / 2)
    if (edge === 'vcenter') nextTop = centerY - Math.floor(entry.height / 2)
    return translateSpec(spec, nextTop - entry.top, nextLeft - entry.left)
  })
}

function packSpecs(
  specs: CanvasAgentObjectSpec[],
  axis: Extract<CanvasAgentAction, { type: 'pack_objects' }>['axis'],
  gap: number,
  align: Extract<CanvasAgentAction, { type: 'pack_objects' }>['align'],
) {
  if (specs.length === 0) return specs
  const bounds = specs.map(getSpecBounds)

  if (axis === 'vertical') {
    const baselineLeft = Math.min(...bounds.map((entry) => entry.left))
    const bandWidth = Math.max(...bounds.map((entry) => entry.width))
    let cursorTop = bounds[0]!.top
    return specs.map((spec, index) => {
      const entry = bounds[index]!
      const nextLeft =
        align === 'center'
          ? baselineLeft + Math.floor((bandWidth - entry.width) / 2)
          : align === 'end'
            ? baselineLeft + (bandWidth - entry.width)
            : baselineLeft
      const translated = translateSpec(spec, cursorTop - entry.top, nextLeft - entry.left)
      cursorTop += entry.height + gap
      return translated
    })
  }

  const baselineTop = Math.min(...bounds.map((entry) => entry.top))
  const bandHeight = Math.max(...bounds.map((entry) => entry.height))
  let cursorLeft = bounds[0]!.left
  return specs.map((spec, index) => {
    const entry = bounds[index]!
    const nextTop =
      align === 'center'
        ? baselineTop + Math.floor((bandHeight - entry.height) / 2)
        : align === 'end'
          ? baselineTop + (bandHeight - entry.height)
          : baselineTop
    const translated = translateSpec(spec, nextTop - entry.top, cursorLeft - entry.left)
    cursorLeft += entry.width + gap
    return translated
  })
}

export function doesShapeObjectIntersectRegion(
  shapeObject: ShapeObject,
  region: { top: number; left: number; width: number; height: number },
) {
  const bounds = getBoundingBox(shapeObject.shape)
  const bottom = region.top + region.height - 1
  const right = region.left + region.width - 1
  return !(
    bounds.bottom < region.top ||
    bounds.top > bottom ||
    bounds.right < region.left ||
    bounds.left > right
  )
}

function upsertGrant(policy: CanvasSharePolicy, nextGrant: Omit<CanvasShareGrant, 'id' | 'createdAt'>): CanvasSharePolicy {
  const now = new Date().toISOString()
  const existingIndex = policy.grants.findIndex((grant) => {
    if (grant.subjectType !== nextGrant.subjectType || grant.subjectId.toLowerCase() !== nextGrant.subjectId.toLowerCase()) {
      return false
    }

    if (grant.target.type !== nextGrant.target.type) return false
    if (grant.target.type === 'portal' && nextGrant.target.type === 'portal') {
      return grant.target.portalId === nextGrant.target.portalId
    }

    return true
  })

  const grants = [...policy.grants]
  const completeGrant: CanvasShareGrant = {
    ...nextGrant,
    id: grants[existingIndex]?.id ?? createRuntimeUuid(),
    createdAt: grants[existingIndex]?.createdAt ?? now,
  }

  if (existingIndex === -1) {
    grants.push(completeGrant)
  } else {
    grants[existingIndex] = completeGrant
  }

  return {
    ...policy,
    grants,
    updatedAt: now,
  }
}

function removeGrant(
  policy: CanvasSharePolicy,
  match: (grant: CanvasShareGrant) => boolean,
  updatedAt: string,
): CanvasSharePolicy {
  return {
    ...policy,
    grants: policy.grants.filter((grant) => !match(grant)),
    updatedAt,
  }
}

function findGrantById(policy: CanvasSharePolicy, grantId: string) {
  return policy.grants.find((grant) => grant.id === grantId) ?? null
}

function upsertGrantById(
  policy: CanvasSharePolicy,
  grantId: string,
  updater: (grant: CanvasShareGrant) => CanvasShareGrant,
  updatedAt: string,
): CanvasSharePolicy {
  return {
    ...policy,
    grants: policy.grants.map((grant) => (grant.id === grantId ? updater(grant) : grant)),
    updatedAt,
  }
}

function resolvePortalRect(portal: CanvasPortal, action: Extract<CanvasAgentAction, { type: 'update_portal' }>) {
  return {
    top: action.top ?? portal.rect.top,
    left: action.left ?? portal.rect.left,
    width: action.width ?? portal.rect.width,
    height: action.height ?? portal.rect.height,
  }
}

function isContainedWithinPortalRect(
  shape: Shape,
  rect: CanvasPortal['rect'],
) {
  const bounds = getBoundingBox(shape)
  return (
    bounds.top >= rect.top &&
    bounds.bottom < rect.top + rect.height &&
    bounds.left >= rect.left &&
    bounds.right < rect.left + rect.width
  )
}

export function shouldMovePortalContents(
  portal: CanvasPortal,
  nextRect: CanvasPortal['rect'],
  moveContents?: boolean,
) {
  if (moveContents === false) return false
  const moved = portal.rect.top !== nextRect.top || portal.rect.left !== nextRect.left
  const resized = portal.rect.width !== nextRect.width || portal.rect.height !== nextRect.height
  return moved && !resized
}

export function applyPortalMoveToEditorState(
  state: AppState,
  portal: CanvasPortal,
  nextRect: CanvasPortal['rect'],
): AppState {
  const deltaRow = nextRect.top - portal.rect.top
  const deltaCol = nextRect.left - portal.rect.left
  if (deltaRow === 0 && deltaCol === 0) return state

  return {
    ...state,
    diagrams: state.diagrams.map((diagram) => {
      if (diagram.id !== portal.canvasId) return diagram

      const nextShapes = diagram.data.shapes.map((shapeObject) =>
        isContainedWithinPortalRect(shapeObject.shape, portal.rect)
          ? {
              ...shapeObject,
              shape: translateUnbounded(shapeObject.shape, {
                r: deltaRow,
                c: deltaCol,
              }),
            }
          : shapeObject,
      )

      return {
        ...diagram,
        data: {
          ...diagram.data,
          shapes: nextShapes,
        },
      }
    }),
  }
}

export function applyAgentActionToEditorState(state: AppState, action: CanvasAgentAction): AppState {
  const canvasId = getCanvasId(state, 'canvasId' in action ? action.canvasId : undefined)

  switch (action.type) {
    case 'upsert_objects':
      return updateDiagram(state, canvasId, (diagram) => {
        const existingById = new Map(diagram.data.shapes.map((shapeObj) => [shapeObj.id, shapeObj]))
        const seenIds = new Set<string>()
        const appended: ShapeObject[] = []
        const replaced = diagram.data.shapes.map((shapeObj) => {
          const matchingSpec = action.objects.find((spec) => spec.id === shapeObj.id)
          if (!matchingSpec) return shapeObj
          seenIds.add(shapeObj.id)
          return buildShapeObjectFromSpec(matchingSpec, shapeObj)
        })

        for (const spec of action.objects) {
          const specId = spec.id ?? null
          if (specId && seenIds.has(specId)) continue
          appended.push(buildShapeObjectFromSpec(spec, specId ? existingById.get(specId) ?? null : null))
        }

        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: [...replaced, ...appended],
          },
        }
      })
    case 'move_objects':
      return updateDiagram(state, canvasId, (diagram) => {
        const selectedIdSet = new Set(action.objectIds)
        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: diagram.data.shapes.map((shapeObj) =>
              selectedIdSet.has(shapeObj.id)
                ? {
                    ...shapeObj,
                    shape: translateUnbounded(shapeObj.shape, {
                      r: action.deltaRow,
                      c: action.deltaCol,
                    }),
                  }
                : shapeObj,
            ),
          },
        }
      })
    case 'delete_objects':
      return updateDiagram(state, canvasId, (diagram) => {
        const selectedIdSet = new Set(action.objectIds)
        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: diagram.data.shapes.filter((shapeObj) => !selectedIdSet.has(shapeObj.id)),
          },
        }
      })
    case 'replace_objects':
      return updateDiagram(state, canvasId, (diagram) => {
        const selectedIdSet = new Set(action.objectIds)
        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: [
              ...diagram.data.shapes.filter((shapeObj) => !selectedIdSet.has(shapeObj.id)),
              ...action.objects.map((spec) => buildShapeObjectFromSpec(spec)),
            ],
          },
        }
      })
    case 'patch_object':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) =>
            shapeObj.id === action.objectId
              ? buildShapeObjectFromSpec(
                  patchSpec(serializeShapeObjectAsAgentSpec(shapeObj), action),
                  shapeObj,
                )
              : shapeObj,
          ),
        },
      }))
    case 'pack_objects':
      return updateDiagram(state, canvasId, (diagram) => {
        const selectedIdSet = new Set(action.objectIds)
        const specsById = new Map(
          diagram.data.shapes
            .filter((shapeObj) => selectedIdSet.has(shapeObj.id))
            .map((shapeObj) => [shapeObj.id, serializeShapeObjectAsAgentSpec(shapeObj)]),
        )
        const packedSpecs = packSpecs(
          action.objectIds.map((objectId) => specsById.get(objectId)).filter(Boolean) as CanvasAgentObjectSpec[],
          action.axis,
          action.gap,
          action.align,
        )
        const packedById = new Map(packedSpecs.map((spec) => [spec.id, spec]))
        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: diagram.data.shapes.map((shapeObj) => {
              const spec = packedById.get(shapeObj.id)
              return spec ? buildShapeObjectFromSpec(spec, shapeObj) : shapeObj
            }),
          },
        }
      })
    case 'align_objects':
      return updateDiagram(state, canvasId, (diagram) => {
        const selectedIdSet = new Set(action.objectIds)
        const specsById = new Map(
          diagram.data.shapes
            .filter((shapeObj) => selectedIdSet.has(shapeObj.id))
            .map((shapeObj) => [shapeObj.id, serializeShapeObjectAsAgentSpec(shapeObj)]),
        )
        const alignedSpecs = alignSpecs(
          action.objectIds.map((objectId) => specsById.get(objectId)).filter(Boolean) as CanvasAgentObjectSpec[],
          action.edge,
        )
        const alignedById = new Map(alignedSpecs.map((spec) => [spec.id, spec]))
        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: diagram.data.shapes.map((shapeObj) => {
              const spec = alignedById.get(shapeObj.id)
              return spec ? buildShapeObjectFromSpec(spec, shapeObj) : shapeObj
            }),
          },
        }
      })
    case 'replace_region':
      return updateDiagram(state, canvasId, (diagram) => {
        const keptShapes = diagram.data.shapes.filter((shapeObj) => {
          if (!doesShapeObjectIntersectRegion(shapeObj, action)) {
            return true
          }
          if (!action.clearTypes || action.clearTypes.length === 0) {
            return false
          }
          return !action.clearTypes.some((type) => shapeObjectMatchesAgentType(shapeObj, type))
        })

        return {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: [
              ...keptShapes,
              ...action.objects.map((spec) => buildShapeObjectFromSpec(spec)),
            ],
          },
        }
      })
    case 'set_canvas_size':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          canvasSize: clampCanvasSize(action.rows, action.cols),
        },
      }))
    case 'expand_canvas':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          canvasSize: {
            rows: diagram.data.canvasSize.rows + Math.max(0, Math.floor(action.rows ?? DEFAULT_EXPAND_ROWS)),
            cols: diagram.data.canvasSize.cols + Math.max(0, Math.floor(action.cols ?? DEFAULT_EXPAND_COLS)),
          },
        },
      }))
    case 'shrink_canvas_to_fit':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          canvasSize: getShrinkToFitCanvasSize(diagram),
        },
      }))
    case 'create_rectangle':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: [
            ...diagram.data.shapes,
            {
              id: createRuntimeUuid(),
              shape: {
                type: 'RECTANGLE',
                tl: { r: action.top, c: action.left },
                br: { r: action.top + action.height - 1, c: action.left + action.width - 1 },
                label: action.label,
                labelLines: action.labelLines ?? [],
              },
            },
          ],
        },
      }))
    case 'create_text':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: [
            ...diagram.data.shapes,
            {
              id: createRuntimeUuid(),
              shape: {
                type: 'TEXT',
                start: { r: action.row, c: action.col },
                lines: action.lines,
              },
            },
          ],
        },
      }))
    case 'move_object':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) => {
            if (shapeObj.id !== action.objectId) return shapeObj
            const anchor = getShapeAnchor(shapeObj.shape)
            const delta = {
              r: action.top != null ? action.top - anchor.r : action.deltaRow ?? 0,
              c: action.left != null ? action.left - anchor.c : action.deltaCol ?? 0,
            }
            return {
              ...shapeObj,
              shape: translateUnbounded(shapeObj.shape, delta),
            }
          }),
        },
      }))
    case 'resize_object':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) => {
            if (shapeObj.id !== action.objectId || shapeObj.shape.type !== 'RECTANGLE') return shapeObj
            const top = action.top ?? shapeObj.shape.tl.r
            const left = action.left ?? shapeObj.shape.tl.c
            const width = action.width ?? shapeObj.shape.br.c - shapeObj.shape.tl.c + 1
            const height = action.height ?? shapeObj.shape.br.r - shapeObj.shape.tl.r + 1
            return {
              ...shapeObj,
              shape: {
                ...shapeObj.shape,
                tl: { r: top, c: left },
                br: { r: top + height - 1, c: left + width - 1 },
              },
            }
          }),
        },
      }))
    case 'delete_object':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.filter((shapeObj) => shapeObj.id !== action.objectId),
        },
      }))
    case 'set_text':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) => {
            if (shapeObj.id !== action.objectId) return shapeObj
            if (shapeObj.shape.type === 'TEXT') {
              return {
                ...shapeObj,
                shape: {
                  ...shapeObj.shape,
                  lines: [...action.lines],
                },
              }
            }
            if (shapeObj.shape.type === 'RECTANGLE') {
              return {
                ...shapeObj,
                shape: {
                  ...shapeObj.shape,
                  labelLines: [...action.lines],
                },
              }
            }
            if (shapeObj.shape.type === 'LINE' || shapeObj.shape.type === 'MULTI_SEGMENT_LINE') {
              return {
                ...shapeObj,
                shape: {
                  ...shapeObj.shape,
                  labelLines: [...action.lines],
                },
              }
            }
            return shapeObj
          }),
        },
      }))
    case 'set_rectangle_label':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) =>
            shapeObj.id === action.objectId && shapeObj.shape.type === 'RECTANGLE'
              ? {
                  ...shapeObj,
                  shape: {
                    ...shapeObj.shape,
                    label: action.label,
                  },
                }
              : shapeObj
          ),
        },
      }))
    case 'set_text_alignment':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) => {
            if (shapeObj.id !== action.objectId) return shapeObj
            if (shapeObj.shape.type === 'TEXT') {
              return {
                ...shapeObj,
                shape: {
                  ...shapeObj.shape,
                  lines: alignTextLines(shapeObj.shape.lines ?? [], action.alignment),
                },
              }
            }
            if (shapeObj.shape.type === 'RECTANGLE') {
              return {
                ...shapeObj,
                style: {
                  ...(shapeObj.style ?? {}),
                  rectangleTextAlignH: action.alignment,
                },
              }
            }
            return shapeObj
          }),
        },
      }))
    case 'enclose_text':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObj) => {
            if (shapeObj.id !== action.objectId || shapeObj.shape.type !== 'TEXT') return shapeObj
            const padding = Math.max(0, action.padding ?? 1)
            const longestLineLength = Math.max(
              1,
              ...shapeObj.shape.lines.map((line) => Array.from(line).length),
            )
            return {
              ...shapeObj,
              shape: {
                type: 'RECTANGLE',
                tl: {
                  r: shapeObj.shape.start.r - padding,
                  c: shapeObj.shape.start.c - padding,
                },
                br: {
                  r: shapeObj.shape.start.r + shapeObj.shape.lines.length - 1 + padding,
                  c: shapeObj.shape.start.c + longestLineLength - 1 + padding,
                },
                labelLines: [...shapeObj.shape.lines],
              },
              style: {
                ...(shapeObj.style ?? {}),
                rectangleFill: 'NONE',
              },
            }
          }),
        },
      }))
    case 'create_line':
      return updateDiagram(state, canvasId, (diagram) => ({
        ...diagram,
        data: {
          ...diagram.data,
          shapes: [
            ...diagram.data.shapes,
            action.from.row === action.to.row
              ? {
                  id: createRuntimeUuid(),
                  shape: {
                    type: 'LINE',
                    axis: 'HORIZONTAL',
                    start: { r: action.from.row, c: action.from.col },
                    end: { r: action.to.row, c: action.to.col },
                    direction: action.from.col > action.to.col ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT',
                  },
                }
              : {
                  id: createRuntimeUuid(),
                  shape: {
                    type: 'LINE',
                    axis: 'VERTICAL',
                    start: { r: action.from.row, c: action.from.col },
                    end: { r: action.to.row, c: action.to.col },
                    direction: action.from.row > action.to.row ? 'UP' : 'DOWN',
                  },
                },
          ],
        },
      }))
    default:
      return state
  }
}

export function applyAgentActionToSharePolicy(
  policy: CanvasSharePolicy,
  action: Extract<CanvasAgentAction, { type: 'add_portal' | 'update_portal' | 'delete_portal' | 'share_canvas' | 'share_canvas_link' | 'unshare_canvas_link' | 'share_portal' | 'share_portal_link' | 'unshare_portal_link' | 'update_grant' | 'revoke_grant' }>,
  fallbackCanvasId: string,
): CanvasSharePolicy {
  const now = new Date().toISOString()

  switch (action.type) {
    case 'add_portal': {
      const portal: CanvasPortal = {
        id: createRuntimeUuid(),
        canvasId: action.canvasId ?? fallbackCanvasId,
        label: action.label,
        rect: {
          top: action.top,
          left: action.left,
          width: action.width,
          height: action.height,
        },
        color: action.color ?? '#38bdf8',
        createdAt: now,
        updatedAt: now,
      }

      return {
        ...policy,
        portals: [...policy.portals, portal],
        updatedAt: now,
      }
    }
    case 'update_portal': {
      const portalIndex = policy.portals.findIndex((portal) => portal.id === action.portalId)
      if (portalIndex === -1) {
        throw new Error('Portal not found.')
      }

      const portals = [...policy.portals]
      const currentPortal = portals[portalIndex]
      portals[portalIndex] = {
        ...currentPortal,
        label: action.label ?? currentPortal.label,
        color: action.color ?? currentPortal.color,
        rect: resolvePortalRect(currentPortal, action),
        updatedAt: now,
      }

      return {
        ...policy,
        portals,
        updatedAt: now,
      }
    }
    case 'delete_portal':
      return {
        ...policy,
        portals: policy.portals.filter((portal) => portal.id !== action.portalId),
        grants: policy.grants.filter(
          (grant) => grant.target.type !== 'portal' || grant.target.portalId !== action.portalId,
        ),
        updatedAt: now,
      }
    case 'share_canvas':
      return upsertGrant(policy, {
        subjectType: 'email',
        subjectId: action.email,
        label: action.email,
        access: action.access,
        target: { type: 'canvas' },
      })
    case 'share_canvas_link': {
      const label = `Link · ${action.token.slice(0, 8)}`
      return upsertGrant(policy, {
        subjectType: 'link',
        subjectId: action.token,
        label,
        access: action.access,
        target: { type: 'canvas' },
      })
    }
    case 'unshare_canvas_link':
      return removeGrant(
        policy,
        (grant) => grant.subjectType === 'link' && grant.subjectId === action.token && grant.target.type === 'canvas',
        now,
      )
    case 'share_portal':
      return (() => {
        const portalPolicy = upsertGrant(policy, {
          subjectType: 'email',
          subjectId: action.email,
          label: action.email,
          access: action.access,
          target: {
            type: 'portal',
            portalId: action.portalId,
          },
        })

        if (action.allowCanvasView) {
          return upsertGrant(portalPolicy, {
            subjectType: 'email',
            subjectId: action.email,
            label: action.email,
            access: 'view',
            target: { type: 'canvas' },
          })
        }

        return removeGrant(
          portalPolicy,
          (grant) =>
            grant.subjectType === 'email' &&
            grant.subjectId.toLowerCase() === action.email.toLowerCase() &&
            grant.target.type === 'canvas',
          now,
        )
      })()
    case 'share_portal_link':
      return (() => {
        const label = `Link · ${action.token.slice(0, 8)}`
        const portalPolicy = upsertGrant(policy, {
          subjectType: 'link',
          subjectId: action.token,
          label,
          access: action.access,
          target: {
            type: 'portal',
            portalId: action.portalId,
          },
        })

        if (action.allowCanvasView) {
          return upsertGrant(portalPolicy, {
            subjectType: 'link',
            subjectId: action.token,
            label,
            access: 'view',
            target: { type: 'canvas' },
          })
        }

        return removeGrant(
          portalPolicy,
          (grant) =>
            grant.subjectType === 'link' &&
            grant.subjectId === action.token &&
            grant.target.type === 'canvas',
          now,
        )
      })()
    case 'unshare_portal_link':
      return removeGrant(
        policy,
        (grant) =>
          grant.subjectType === 'link' &&
          grant.subjectId === action.token &&
          ((grant.target.type === 'portal' && grant.target.portalId === action.portalId) || grant.target.type === 'canvas'),
        now,
      )
    case 'update_grant': {
      const grant = findGrantById(policy, action.grantId)
      if (!grant) {
        throw new Error('Grant not found.')
      }

      if (grant.target.type === 'canvas') {
        return upsertGrantById(
          policy,
          action.grantId,
          (current) => ({
            ...current,
            access: action.access,
          }),
          now,
        )
      }

      const nextPortalPolicy = upsertGrantById(
        policy,
        action.grantId,
        (current) => ({
          ...current,
          access: action.access,
        }),
        now,
      )

      if (action.allowCanvasView) {
        return upsertGrant(nextPortalPolicy, {
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
          label: grant.label,
          access: 'view',
          target: { type: 'canvas' },
        })
      }

      return removeGrant(
        nextPortalPolicy,
        (current) =>
          current.id !== action.grantId &&
          current.subjectType === grant.subjectType &&
          current.subjectId === grant.subjectId &&
          current.target.type === 'canvas',
        now,
      )
    }
    case 'revoke_grant': {
      const grant = findGrantById(policy, action.grantId)
      if (!grant) {
        throw new Error('Grant not found.')
      }

      return removeGrant(
        policy,
        (current) => {
          if (current.id === action.grantId) return true
          if (!action.revokeCompanionCanvasGrant) return false

          return (
            current.subjectType === grant.subjectType &&
            current.subjectId === grant.subjectId &&
            current.target.type === 'canvas'
          )
        },
        now,
      )
    }
  }
}
