import {
  hasCanvasAccessAtPoint,
  type CanvasAccessSummary,
  type CanvasCollaboratorPresence,
  type CanvasResolvedPortalAccess,
} from '@canvascii/core'

export type EditorInteractionMeta = {
  activeCanvasId: string
  activeTool: string
  selectedObjectIds: string[]
  hoveredCell: {
    row: number
    col: number
  } | null
  textCursorCell: {
    row: number
    col: number
  } | null
  selectedBounds: {
    top: number
    left: number
    width: number
    height: number
  } | null
  canvasSize: {
    rows: number
    cols: number
  }
  viewportBounds: {
    top: number
    left: number
    width: number
    height: number
  } | null
  draftShape: Record<string, unknown> | null
  draftObjects: Array<{
    id: string
    shape: Record<string, unknown>
    style: Record<string, unknown> | null
  }> | null
  draftStyleMode: 'ASCII' | 'UNICODE' | null
  draftStyle: Record<string, unknown> | null
  draftPortalBounds: {
    top: number
    left: number
    width: number
    height: number
  } | null
}

export type EditorTerminalPreview =
  | {
      kind: 'point'
      canvasId: string
      row: number
      col: number
      label: string
    }
  | {
      kind: 'rect'
      canvasId: string
      top: number
      left: number
      width: number
      height: number
      label: string
    }
  | {
      kind: 'line'
      canvasId: string
      from: {
        row: number
        col: number
      }
      to: {
        row: number
        col: number
      }
      label: string
    }
  | {
      kind: 'info'
      label: string
    }

export type EditorCollaborationProps = {
  accessSummary?: CanvasAccessSummary | null
  collaborators?: CanvasCollaboratorPresence[]
  portals?: CanvasResolvedPortalAccess[]
  canManagePortals?: boolean
  onEditorMetaChange?: (meta: EditorInteractionMeta) => void
  onCreateFenceFromBounds?: (bounds: {
    top: number
    left: number
    width: number
    height: number
  }) => Promise<void>
  onUpdateFence?: (input: {
    fenceId: string
    top: number
    left: number
    width: number
    height: number
  }) => Promise<void>
  onDeleteFence?: (fenceId: string) => Promise<void>
  onOpenFenceShare?: (fenceId: string) => void
  onFenceDraftBoundsChange?: (bounds: {
    top: number
    left: number
    width: number
    height: number
  } | null) => void
  canCreatePortalDocuments?: boolean
  onResolvePortalTarget?: (input: {
    mode: 'new-canvas' | 'same-canvas'
    rect: {
      top: number
      left: number
      width: number
      height: number
    }
    activeCanvasId: string
  }) => Promise<{
    documentId: string | null
    canvasId: string
    top: number
    left: number
    label?: string | null
  }>
  onOpenPortalDestination?: (input: {
    portalId: string
    label: string
    sourceDocumentId: string | null
    sourceCanvasId: string
    sourceRect: {
      top: number
      left: number
      width: number
      height: number
    }
    target: {
      documentId: string | null
      canvasId: string
      top: number
      left: number
      width: number
      height: number
    }
  }) => void
  portalTargetShapeMap?: Record<string, Array<{
    id: string
    shape: Record<string, unknown>
    style?: Record<string, unknown>
  }>>
  componentDefinitionMap?: Record<string, {
    name: string
    attributes: Array<{
      key: string
      defaultValue: string
    }>
    canvasSize: {
      rows: number
      cols: number
    }
  }>
  portalNavigationFocus?: {
    canvasId: string
    rect: {
      top: number
      left: number
      width: number
      height: number
    }
    label?: string | null
  } | null
  onPortalNavigationFocusHandled?: () => void
  onDismissPortalNavigationFocus?: () => void
  terminalPreview?: EditorTerminalPreview | null
  onRequestCreateComponentFromSelection?: (shapeIds?: string[]) => void
}

function accessRank(access: CanvasAccessSummary['rootAccess']): number {
  switch (access) {
    case 'owner':
      return 3
    case 'edit':
      return 2
    case 'view':
      return 1
    default:
      return 0
  }
}

function pointWithinPortal(
  portal: CanvasAccessSummary['portals'][number],
  point: { row: number; col: number },
) {
  return (
    point.row >= portal.rect.top &&
    point.row < portal.rect.top + portal.rect.height &&
    point.col >= portal.rect.left &&
    point.col < portal.rect.left + portal.rect.width
  )
}

function rectOverlapsPortal(
  rect: { top: number; left: number; width: number; height: number },
  portal: CanvasAccessSummary['portals'][number],
) {
  const rectBottom = rect.top + rect.height
  const rectRight = rect.left + rect.width
  const portalBottom = portal.rect.top + portal.rect.height
  const portalRight = portal.rect.left + portal.rect.width

  return rect.top < portalBottom && rectBottom > portal.rect.top && rect.left < portalRight && rectRight > portal.rect.left
}

function intersectionArea(
  rect: { top: number; left: number; width: number; height: number },
  portal: CanvasAccessSummary['portals'][number],
) {
  if (!rectOverlapsPortal(rect, portal)) return 0
  const top = Math.max(rect.top, portal.rect.top)
  const left = Math.max(rect.left, portal.rect.left)
  const bottom = Math.min(rect.top + rect.height, portal.rect.top + portal.rect.height)
  const right = Math.min(rect.left + rect.width, portal.rect.left + portal.rect.width)
  return Math.max(0, bottom - top) * Math.max(0, right - left)
}

function clipRectToPortal(
  rect: { top: number; left: number; width: number; height: number },
  portal: CanvasAccessSummary['portals'][number],
) {
  if (!rectOverlapsPortal(rect, portal)) return null

  const top = Math.max(rect.top, portal.rect.top)
  const left = Math.max(rect.left, portal.rect.left)
  const bottom = Math.min(rect.top + rect.height, portal.rect.top + portal.rect.height)
  const right = Math.min(rect.left + rect.width, portal.rect.left + portal.rect.width)

  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export function canViewerSeeCollaboratorCursor(
  accessSummary: CanvasAccessSummary | null | undefined,
  cursor: CanvasCollaboratorPresence['cursor'],
) {
  if (!cursor || !accessSummary) return true

  const rootAccessRank = accessRank(accessSummary.rootAccess)
  const scopedVisiblePortals = accessSummary.portals.filter(
    (portal) => portal.canvasId === cursor.canvasId && accessRank(portal.access) > rootAccessRank,
  )

  if (scopedVisiblePortals.length > 0) {
    return scopedVisiblePortals.some((portal) => pointWithinPortal(portal, { row: cursor.row, col: cursor.col }))
  }

  return hasCanvasAccessAtPoint(
    accessSummary,
    cursor.canvasId,
    { row: cursor.row, col: cursor.col },
    'view',
  )
}

export function resolvePresenceViewport(
  accessSummary: CanvasAccessSummary,
  meta: EditorInteractionMeta | null,
): CanvasCollaboratorPresence['viewport'] {
  const viewportBounds = meta?.viewportBounds
  if (!viewportBounds || !meta) return null

  const rootAccessRank = accessRank(accessSummary.rootAccess)
  const scopedVisiblePortals = accessSummary.portals.filter(
    (portal) => portal.canvasId === meta.activeCanvasId && accessRank(portal.access) > rootAccessRank,
  )

  if (scopedVisiblePortals.length === 0) {
    const centerPoint = {
      row: viewportBounds.top + Math.max(0, Math.floor((viewportBounds.height - 1) / 2)),
      col: viewportBounds.left + Math.max(0, Math.floor((viewportBounds.width - 1) / 2)),
    }

    return hasCanvasAccessAtPoint(accessSummary, meta.activeCanvasId, centerPoint, 'view')
      ? {
          canvasId: meta.activeCanvasId,
          rect: viewportBounds,
        }
      : null
  }

  const bestPortal = scopedVisiblePortals
    .map((portal) => ({
      portal,
      area: intersectionArea(viewportBounds, portal),
    }))
    .sort((left, right) => right.area - left.area)[0]

  if (!bestPortal || bestPortal.area <= 0) {
    return null
  }

  const clippedRect = clipRectToPortal(viewportBounds, bestPortal.portal)
  if (!clippedRect || clippedRect.width <= 0 || clippedRect.height <= 0) {
    return null
  }

  return {
    canvasId: meta.activeCanvasId,
    rect: clippedRect,
  }
}

export function canViewerSeeCollaboratorViewport(
  accessSummary: CanvasAccessSummary | null | undefined,
  viewport: CanvasCollaboratorPresence['viewport'],
) {
  if (!viewport || !accessSummary) return true

  const rootAccessRank = accessRank(accessSummary.rootAccess)
  const scopedVisiblePortals = accessSummary.portals.filter(
    (portal) => portal.canvasId === viewport.canvasId && accessRank(portal.access) > rootAccessRank,
  )

  if (scopedVisiblePortals.length > 0) {
    return scopedVisiblePortals.some((portal) => rectOverlapsPortal(viewport.rect, portal))
  }

  const centerPoint = {
    row: viewport.rect.top + Math.max(0, Math.floor((viewport.rect.height - 1) / 2)),
    col: viewport.rect.left + Math.max(0, Math.floor((viewport.rect.width - 1) / 2)),
  }

  return hasCanvasAccessAtPoint(accessSummary, viewport.canvasId, centerPoint, 'view')
}
