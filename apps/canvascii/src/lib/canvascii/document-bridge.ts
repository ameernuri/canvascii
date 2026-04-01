import type {
  CanvasDocument,
  CanvasObject,
  CanvasObjectGeometry,
  CanvasPoint,
  CanvasRegion,
  CanvasSegment,
} from '@canvascii/core'
import type { AppState, Diagram } from '@/components/asciip-core/store/appSlice'
import type { DiagramData, ShapeObject } from '@/components/asciip-core/store/diagramSlice'
import type { Line, MultiSegment } from '@/components/asciip-core/models/shapes'
import { initAppState } from '@/components/asciip-core/store/appSlice'
import { initDiagramData } from '@/components/asciip-core/store/diagramSlice'
import type { CanvasPortalView } from '@/lib/canvascii/live-portals'

function toPoint(coords: { r: number; c: number }): CanvasPoint {
  return {
    row: coords.r,
    col: coords.c,
  }
}

function fromPoint(point: CanvasPoint) {
  return {
    r: point.row,
    c: point.col,
  }
}

function toSegment(segment: {
  axis: 'HORIZONTAL' | 'VERTICAL'
  start: { r: number; c: number }
  end: { r: number; c: number }
  direction: string
}): CanvasSegment {
  if (segment.axis === 'HORIZONTAL') {
    return {
      axis: 'horizontal',
      start: toPoint(segment.start),
      end: toPoint(segment.end),
      direction: segment.direction === 'RIGHT_TO_LEFT' ? 'right-to-left' : 'left-to-right',
    }
  }

  return {
    axis: 'vertical',
    start: toPoint(segment.start),
    end: toPoint(segment.end),
    direction: segment.direction === 'UP' ? 'up' : 'down',
  }
}

function fromSegment(segment: CanvasSegment) {
  if (segment.axis === 'horizontal') {
    return {
      axis: 'HORIZONTAL' as const,
      start: fromPoint(segment.start),
      end: fromPoint(segment.end),
      direction: segment.direction === 'right-to-left' ? 'RIGHT_TO_LEFT' as const : 'LEFT_TO_RIGHT' as const,
    }
  }

  return {
    axis: 'VERTICAL' as const,
    start: fromPoint(segment.start),
    end: fromPoint(segment.end),
    direction: segment.direction === 'up' ? 'UP' as const : 'DOWN' as const,
  }
}

function toGeometry(shape: ShapeObject['shape']): CanvasObjectGeometry {
  switch (shape.type) {
    case 'RECTANGLE':
      return {
        type: 'rectangle',
        topLeft: toPoint(shape.tl),
        bottomRight: toPoint(shape.br),
        label: shape.label,
        labelLines: shape.labelLines ?? [],
      }
    case 'LINE':
      return {
        type: 'line',
        segment: toSegment(shape),
      }
    case 'MULTI_SEGMENT_LINE':
      return {
        type: 'polyline',
        segments: shape.segments.map(toSegment),
      }
    case 'TEXT':
      return {
        type: 'text',
        start: toPoint(shape.start),
        lines: shape.lines ?? [],
      }
  }
}

function toShapeMetadata(shape: ShapeObject["shape"]) {
  if (shape.type !== "LINE" && shape.type !== "MULTI_SEGMENT_LINE") {
    return undefined
  }

  return {
    startBinding: shape.startBinding,
    endBinding: shape.endBinding,
    labelLines: shape.labelLines,
    closed: shape.type === "MULTI_SEGMENT_LINE" ? shape.closed : undefined,
  }
}

function toShape(
  geometry: CanvasObjectGeometry,
  metadata?: Record<string, unknown> | null,
) {
  switch (geometry.type) {
    case 'rectangle':
      return {
        type: 'RECTANGLE' as const,
        tl: fromPoint(geometry.topLeft),
        br: fromPoint(geometry.bottomRight),
        label: geometry.label,
        labelLines: geometry.labelLines ?? [],
      }
    case 'line':
      return {
        type: 'LINE' as const,
        ...fromSegment(geometry.segment),
        startBinding: metadata?.startBinding as Line["startBinding"] | undefined,
        endBinding: metadata?.endBinding as Line["endBinding"] | undefined,
        labelLines: metadata?.labelLines as string[] | undefined,
      }
    case 'polyline':
      return {
        type: 'MULTI_SEGMENT_LINE' as const,
        segments: geometry.segments.map(fromSegment),
        startBinding: metadata?.startBinding as MultiSegment["startBinding"] | undefined,
        endBinding: metadata?.endBinding as MultiSegment["endBinding"] | undefined,
        labelLines: metadata?.labelLines as string[] | undefined,
        closed: metadata?.closed as boolean | undefined,
      }
    case 'text':
      return {
        type: 'TEXT' as const,
        start: fromPoint(geometry.start),
        lines: geometry.lines ?? [],
      }
    case 'group':
      return null
  }
}

function toRootRegion(diagram: Diagram, now: string): CanvasRegion {
  return {
    id: `${diagram.id}:root-region`,
    canvasId: diagram.id,
    label: 'Canvas',
    rect: {
      top: 0,
      left: 0,
      width: diagram.data.canvasSize.cols,
      height: diagram.data.canvasSize.rows,
    },
    ownerActorId: null,
    permissionPolicyId: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
}

export function editorStateToCanvasDocument(
  editorState: AppState,
  options?: {
    documentId?: string
    documentName?: string
    createdAt?: string
    updatedAt?: string
  },
): CanvasDocument {
  const now = options?.updatedAt ?? new Date().toISOString()
  const createdAt = options?.createdAt ?? now

  const canvases = editorState.diagrams.map((diagram) => ({
    id: diagram.id,
    name: diagram.name,
    bounds: {
      width: diagram.data.canvasSize.cols,
      height: diagram.data.canvasSize.rows,
    },
    defaultRenderMode: diagram.data.styleMode,
    ownerActorId: null,
    createdAt,
    updatedAt: now,
    version: 1,
    metadata: {
      globalStyle: diagram.data.globalStyle,
      portalViews: diagram.data.portalViews,
      groups: diagram.data.groups,
      parentCanvasId: diagram.parentCanvasId,
      canvasKind: diagram.kind,
      sourceCanvasId: diagram.sourceCanvasId,
      componentAttributes: diagram.componentAttributes,
    },
  }))

  const regions = editorState.diagrams.map((diagram) => toRootRegion(diagram, now))

  const objects: CanvasObject[] = editorState.diagrams.flatMap((diagram) =>
    diagram.data.shapes.map((shapeObject, index) => ({
      id: shapeObject.id,
      canvasId: diagram.id,
      regionId: `${diagram.id}:root-region`,
      type: toGeometry(shapeObject.shape).type,
      geometry: toGeometry(shapeObject.shape),
      content: null,
      style: shapeObject.style ?? {},
      metadata: toShapeMetadata(shapeObject.shape),
      zIndex: index,
      locked: false,
      createdAt,
      updatedAt: now,
      version: 1,
    })),
  )

  return {
    id: options?.documentId ?? `canvascii-${editorState.activeDiagramId}`,
    activeCanvasId: editorState.activeDiagramId,
    canvases,
    regions,
    objects,
    createdAt,
    updatedAt: now,
    version: 1,
    metadata: {
      documentName: options?.documentName ?? null,
    },
  }
}

export function canvasDocumentToDiagramData(
  document: CanvasDocument,
  canvasId: string,
): DiagramData | null {
  const canvas = document.canvases.find((candidate) => candidate.id === canvasId)
  if (!canvas) {
    return null
  }

  const fallbackGlobalStyle = initDiagramData().globalStyle
  const portalViews = Array.isArray(canvas.metadata?.portalViews)
    ? (canvas.metadata?.portalViews as CanvasPortalView[])
    : []
  const groups = Array.isArray(canvas.metadata?.groups)
    ? (canvas.metadata?.groups as Diagram['data']['groups'])
    : []
  const canvasObjects = document.objects
    .filter((object) => object.canvasId === canvas.id)
    .sort((left, right) => left.zIndex - right.zIndex)

  const shapes = canvasObjects
    .map((object) => {
      const shape = toShape(object.geometry, object.metadata ?? null)
      if (!shape) return null
      return {
        id: object.id,
        shape,
        style: object.style,
      }
    })
    .filter(Boolean) as ShapeObject[]

  return {
    canvasSize: {
      rows: canvas.bounds.height,
      cols: canvas.bounds.width,
    },
    shapes,
    groups,
    portalViews,
    styleMode: canvas.defaultRenderMode,
    globalStyle: (canvas.metadata?.globalStyle as Diagram['data']['globalStyle'] | undefined) ?? fallbackGlobalStyle,
  }
}

export function canvasDocumentToEditorState(document: CanvasDocument): AppState {
  if (!document.canvases.length) {
    return initAppState()
  }

  return {
    diagrams: document.canvases.map((canvas) => {
      return {
        id: canvas.id,
        name: canvas.name,
        parentCanvasId:
          typeof canvas.metadata?.parentCanvasId === 'string'
            ? (canvas.metadata.parentCanvasId as string)
            : null,
        kind:
          canvas.metadata?.canvasKind === 'component'
            ? 'component'
            : 'page',
        sourceCanvasId:
          typeof canvas.metadata?.sourceCanvasId === 'string'
            ? (canvas.metadata.sourceCanvasId as string)
            : null,
        componentAttributes: Array.isArray(canvas.metadata?.componentAttributes)
          ? (canvas.metadata.componentAttributes as Diagram['componentAttributes'])
          : [],
        data: canvasDocumentToDiagramData(document, canvas.id) ?? initDiagramData(),
      }
    }),
    activeDiagramId: document.activeCanvasId,
    createDiagramInProgress: false,
    deleteDiagramInProgress: null,
    renameDiagramInProgress: null,
  }
}
