import { describe, expect, it } from 'vitest'
import { resolvePresenceCursor, shouldWriteSharedState } from './collaborative-editor-shell'
import type { CanvasAccessSummary } from '@canvascii/core'
import { canViewerSeeCollaboratorCursor, canViewerSeeCollaboratorViewport, resolvePresenceViewport } from '@/lib/canvascii/collaboration'
import type { EditorInteractionMeta } from '@/lib/canvascii/collaboration'

function createMeta(input: Partial<EditorInteractionMeta>): EditorInteractionMeta {
  return {
    activeCanvasId: 'canvas-1',
    activeTool: 'SELECT',
    selectedObjectIds: [],
    hoveredCell: null,
    textCursorCell: null,
    selectedBounds: null,
    canvasSize: {
      rows: 80,
      cols: 120,
    },
    viewportBounds: null,
    draftShape: null,
    draftObjects: null,
    draftStyleMode: null,
    draftStyle: null,
    draftPortalBounds: null,
    ...input,
  }
}

describe('resolvePresenceCursor', () => {
  it('hides portal-scoped collaborator cursors outside their portal', () => {
    const accessSummary: CanvasAccessSummary = {
      documentId: 'doc-1',
      rootAccess: 'view',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: false,
      portals: [
        {
          id: 'portal-1',
          canvasId: 'canvas-1',
          label: 'Portal',
          color: '#38bdf8',
          createdAt: '2026-03-08T05:00:00.000Z',
          updatedAt: '2026-03-08T05:00:00.000Z',
          access: 'edit',
          rect: {
            top: 10,
            left: 10,
            width: 8,
            height: 6,
          },
        },
      ],
    }

    const insidePortal = resolvePresenceCursor(
      accessSummary,
      createMeta({
        hoveredCell: { row: 12, col: 12 },
      }),
    )
    const outsidePortal = resolvePresenceCursor(
      accessSummary,
      createMeta({
        hoveredCell: { row: 2, col: 2 },
      }),
    )

    expect(insidePortal).toEqual({
      canvasId: 'canvas-1',
      row: 12,
      col: 12,
    })
    expect(outsidePortal).toBeNull()
  })

  it('keeps whole-canvas collaborator cursors visible anywhere', () => {
    const accessSummary: CanvasAccessSummary = {
      documentId: 'doc-1',
      rootAccess: 'edit',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: true,
      portals: [],
    }

    expect(
      resolvePresenceCursor(
        accessSummary,
        createMeta({
          hoveredCell: { row: 30, col: 40 },
        }),
      ),
    ).toEqual({
      canvasId: 'canvas-1',
      row: 30,
      col: 40,
    })
  })

  it('hides collaborator cursors outside elevated portals even when whole-canvas view is allowed', () => {
    const accessSummary: CanvasAccessSummary = {
      documentId: 'doc-1',
      rootAccess: 'view',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: false,
      portals: [
        {
          id: 'portal-1',
          canvasId: 'canvas-1',
          label: 'Edit portal',
          color: '#38bdf8',
          createdAt: '2026-03-08T05:00:00.000Z',
          updatedAt: '2026-03-08T05:00:00.000Z',
          access: 'edit',
          rect: {
            top: 10,
            left: 10,
            width: 8,
            height: 6,
          },
        },
      ],
    }

    expect(
      canViewerSeeCollaboratorCursor(accessSummary, {
        canvasId: 'canvas-1',
        row: 12,
        col: 12,
      }),
    ).toBe(true)

    expect(
      canViewerSeeCollaboratorCursor(accessSummary, {
        canvasId: 'canvas-1',
        row: 2,
        col: 2,
      }),
    ).toBe(false)
  })
})

describe('resolvePresenceViewport', () => {
  it('clips viewport bounds to elevated visible portals', () => {
    const accessSummary: CanvasAccessSummary = {
      documentId: 'doc-1',
      rootAccess: 'view',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: false,
      portals: [
        {
          id: 'portal-1',
          canvasId: 'canvas-1',
          label: 'Portal',
          color: '#38bdf8',
          createdAt: '2026-03-08T05:00:00.000Z',
          updatedAt: '2026-03-08T05:00:00.000Z',
          access: 'edit',
          rect: {
            top: 10,
            left: 10,
            width: 8,
            height: 6,
          },
        },
      ],
    }

    expect(
      resolvePresenceViewport(
        accessSummary,
        createMeta({
          viewportBounds: { top: 8, left: 8, width: 10, height: 10 },
        }),
      ),
    ).toEqual({
      canvasId: 'canvas-1',
      rect: {
        top: 10,
        left: 10,
        width: 8,
        height: 6,
      },
    })
  })

  it('hides viewport bounds outside elevated portals', () => {
    const accessSummary: CanvasAccessSummary = {
      documentId: 'doc-1',
      rootAccess: 'view',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: false,
      portals: [
        {
          id: 'portal-1',
          canvasId: 'canvas-1',
          label: 'Portal',
          color: '#38bdf8',
          createdAt: '2026-03-08T05:00:00.000Z',
          updatedAt: '2026-03-08T05:00:00.000Z',
          access: 'edit',
          rect: {
            top: 10,
            left: 10,
            width: 8,
            height: 6,
          },
        },
      ],
    }

    expect(
      resolvePresenceViewport(
        accessSummary,
        createMeta({
          viewportBounds: { top: 0, left: 0, width: 5, height: 5 },
        }),
      ),
    ).toBeNull()
  })

  it('filters remote viewport visibility by scoped access', () => {
    const accessSummary: CanvasAccessSummary = {
      documentId: 'doc-1',
      rootAccess: 'view',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: false,
      portals: [
        {
          id: 'portal-1',
          canvasId: 'canvas-1',
          label: 'Portal',
          color: '#38bdf8',
          createdAt: '2026-03-08T05:00:00.000Z',
          updatedAt: '2026-03-08T05:00:00.000Z',
          access: 'edit',
          rect: {
            top: 10,
            left: 10,
            width: 8,
            height: 6,
          },
        },
      ],
    }

    expect(
      canViewerSeeCollaboratorViewport(accessSummary, {
        canvasId: 'canvas-1',
        rect: { top: 11, left: 11, width: 4, height: 4 },
      }),
    ).toBe(true)

    expect(
      canViewerSeeCollaboratorViewport(accessSummary, {
        canvasId: 'canvas-1',
        rect: { top: 1, left: 1, width: 4, height: 4 },
      }),
    ).toBe(false)
  })
})

describe('shouldWriteSharedState', () => {
  it('blocks stale live state writes in collaborative rooms', () => {
    expect(
      shouldWriteSharedState({
        hasProvider: true,
        lastSharedJson: '{"remote":true}',
        nextJson: '{"stale":true}',
        pendingLocalCommitStateJson: null,
      }),
    ).toEqual({
      shouldWrite: false,
      usedPendingLocalCommit: false,
    })
  })

  it('allows committed local batches to write in collaborative rooms', () => {
    expect(
      shouldWriteSharedState({
        hasProvider: true,
        lastSharedJson: '{"remote":true}',
        nextJson: '{"local":true}',
        pendingLocalCommitStateJson: '{"local":true}',
      }),
    ).toEqual({
      shouldWrite: true,
      usedPendingLocalCommit: true,
    })
  })

  it('allows local-only rooms to write unsynced editor state', () => {
    expect(
      shouldWriteSharedState({
        hasProvider: false,
        lastSharedJson: '{"before":true}',
        nextJson: '{"after":true}',
        pendingLocalCommitStateJson: null,
      }),
    ).toEqual({
      shouldWrite: true,
      usedPendingLocalCommit: false,
    })
  })
})
