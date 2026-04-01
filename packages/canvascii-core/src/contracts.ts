export type CanvasRenderMode = 'ASCII' | 'UNICODE'

export type CanvasPoint = {
  row: number
  col: number
}

export type CanvasRect = {
  top: number
  left: number
  width: number
  height: number
}

export type CanvasSegment =
  | {
      axis: 'horizontal'
      start: CanvasPoint
      end: CanvasPoint
      direction: 'left-to-right' | 'right-to-left'
    }
  | {
      axis: 'vertical'
      start: CanvasPoint
      end: CanvasPoint
      direction: 'up' | 'down'
    }

export type CanvasObjectGeometry =
  | {
      type: 'rectangle'
      topLeft: CanvasPoint
      bottomRight: CanvasPoint
      label?: string
      labelLines?: string[]
    }
  | {
      type: 'line'
      segment: CanvasSegment
    }
  | {
      type: 'polyline'
      segments: CanvasSegment[]
    }
  | {
      type: 'text'
      start: CanvasPoint
      lines: string[]
    }
  | {
      type: 'group'
      childObjectIds: string[]
    }

export type Canvas = {
  id: string
  name: string
  bounds: { width: number; height: number }
  defaultRenderMode: CanvasRenderMode
  ownerActorId: string | null
  createdAt: string
  updatedAt: string
  version: number
  metadata?: Record<string, unknown>
}

export type CanvasRegion = {
  id: string
  canvasId: string
  label: string
  rect: CanvasRect
  ownerActorId: string | null
  permissionPolicyId: string | null
  createdAt: string
  updatedAt: string
  version: number
}

export type CanvasObject = {
  id: string
  canvasId: string
  regionId: string
  type: CanvasObjectGeometry['type']
  geometry: CanvasObjectGeometry
  content: Record<string, unknown> | null
  style: Record<string, unknown>
  zIndex: number
  locked: boolean
  createdAt: string
  updatedAt: string
  version: number
  metadata?: Record<string, unknown>
}

export type CanvasDocument = {
  id: string
  activeCanvasId: string
  canvases: Canvas[]
  regions: CanvasRegion[]
  objects: CanvasObject[]
  createdAt: string
  updatedAt: string
  version: number
  metadata?: Record<string, unknown>
}

export type CanvasCommand =
  | {
      id: string
      type: 'canvas.create'
      actorId: string | null
      at: string
      input: {
        canvas: Canvas
        region: CanvasRegion
      }
    }
  | {
      id: string
      type: 'canvas.upsert'
      actorId: string | null
      at: string
      input: {
        canvas: Canvas
        region: CanvasRegion
      }
    }
  | {
      id: string
      type: 'canvas.rename'
      actorId: string | null
      at: string
      input: {
        canvasId: string
        name: string
      }
    }
  | {
      id: string
      type: 'canvas.set-active'
      actorId: string | null
      at: string
      input: {
        canvasId: string
      }
    }
  | {
      id: string
      type: 'canvas.delete'
      actorId: string | null
      at: string
      input: {
        canvasId: string
      }
    }
  | {
      id: string
      type: 'object.upsert'
      actorId: string | null
      at: string
      input: {
        object: CanvasObject
      }
    }
  | {
      id: string
      type: 'object.delete'
      actorId: string | null
      at: string
      input: {
        objectId: string
      }
    }

export type CanvasEvent =
  | {
      id: string
      documentId: string
      commandId: string
      type: 'canvas.created'
      at: string
      payload: {
        canvas: Canvas
        region: CanvasRegion
      }
    }
  | {
      id: string
      documentId: string
      commandId: string
      type: 'canvas.upserted'
      at: string
      payload: {
        canvas: Canvas
        region: CanvasRegion
      }
    }
  | {
      id: string
      documentId: string
      commandId: string
      type: 'canvas.renamed'
      at: string
      payload: {
        canvasId: string
        name: string
      }
    }
  | {
      id: string
      documentId: string
      commandId: string
      type: 'canvas.activated'
      at: string
      payload: {
        canvasId: string
      }
    }
  | {
      id: string
      documentId: string
      commandId: string
      type: 'canvas.deleted'
      at: string
      payload: {
        canvasId: string
      }
    }
  | {
      id: string
      documentId: string
      commandId: string
      type: 'object.upserted'
      at: string
      payload: {
        object: CanvasObject
      }
    }
  | {
      id: string
      documentId: string
      commandId: string
      type: 'object.deleted'
      at: string
      payload: {
        objectId: string
      }
    }
