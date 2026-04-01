import { describe, expect, it } from 'vitest'
import { initAppState } from '@/components/asciip-core/store/appSlice'
import {
  applyAgentActionToEditorState,
  applyAgentActionToSharePolicy,
  applyPortalMoveToEditorState,
  shouldMovePortalContents,
} from '@/lib/canvascii/agent-edit'
import { createDefaultCanvasSharePolicy, type CanvasPortal } from '@canvascii/core'

describe('portal agent edit helpers', () => {
  it('patches an existing rectangle object in place', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'rect-1',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 2, c: 4 },
          br: { r: 6, c: 14 },
          labelLines: ['Overview'],
        },
      },
    ]

    const nextState = applyAgentActionToEditorState(state, {
      type: 'patch_object',
      objectId: 'rect-1',
      top: 10,
      left: 20,
      width: 12,
      height: 4,
      body: 'Updated',
      alignment: 'CENTER',
    })

    expect(nextState.diagrams[0]!.data.shapes[0]).toMatchObject({
      id: 'rect-1',
      shape: {
        tl: { r: 10, c: 20 },
        br: { r: 13, c: 31 },
        labelLines: ['Updated'],
      },
      style: {
        rectangleTextAlignH: 'CENTER',
      },
    })
  })

  it('replaces exact objects without clearing the whole region', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'rect-1',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 2, c: 4 },
          br: { r: 6, c: 14 },
          labelLines: [],
        },
      },
      {
        id: 'text-1',
        shape: {
          type: 'TEXT',
          start: { r: 20, c: 20 },
          lines: ['keep'],
        },
      },
    ]

    const nextState = applyAgentActionToEditorState(state, {
      type: 'replace_objects',
      objectIds: ['rect-1'],
      objects: [{ type: 'text', row: 3, col: 5, lines: ['new'] }],
    })

    expect(nextState.diagrams[0]!.data.shapes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'text-1' }),
        expect.objectContaining({ shape: expect.objectContaining({ type: 'TEXT', lines: ['new'] }) }),
      ]),
    )
    expect(nextState.diagrams[0]!.data.shapes.find((shape) => shape.id === 'rect-1')).toBeUndefined()
  })

  it('packs objects into a shared-border vertical stack', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'a',
        shape: { type: 'RECTANGLE', tl: { r: 5, c: 10 }, br: { r: 7, c: 20 }, labelLines: [] },
      },
      {
        id: 'b',
        shape: { type: 'RECTANGLE', tl: { r: 15, c: 14 }, br: { r: 17, c: 24 }, labelLines: [] },
      },
    ]

    const nextState = applyAgentActionToEditorState(state, {
      type: 'pack_objects',
      objectIds: ['a', 'b'],
      axis: 'vertical',
      gap: -1,
      align: 'start',
    })

    const shapeA = nextState.diagrams[0]!.data.shapes.find((shape) => shape.id === 'a')!.shape
    const shapeB = nextState.diagrams[0]!.data.shapes.find((shape) => shape.id === 'b')!.shape
    expect(shapeA).toMatchObject({ tl: { r: 5, c: 10 }, br: { r: 7, c: 20 } })
    expect(shapeB).toMatchObject({ tl: { r: 7, c: 10 }, br: { r: 9, c: 20 } })
  })

  it('aligns objects to the same left edge', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'a',
        shape: { type: 'RECTANGLE', tl: { r: 5, c: 10 }, br: { r: 7, c: 20 }, labelLines: [] },
      },
      {
        id: 'b',
        shape: { type: 'RECTANGLE', tl: { r: 9, c: 14 }, br: { r: 11, c: 24 }, labelLines: [] },
      },
    ]

    const nextState = applyAgentActionToEditorState(state, {
      type: 'align_objects',
      objectIds: ['a', 'b'],
      edge: 'left',
    })

    const shapeA = nextState.diagrams[0]!.data.shapes.find((shape) => shape.id === 'a')!.shape
    const shapeB = nextState.diagrams[0]!.data.shapes.find((shape) => shape.id === 'b')!.shape
    expect(shapeA).toMatchObject({ tl: { c: 10 } })
    expect(shapeB).toMatchObject({ tl: { c: 10 } })
  })

  it('sets the canvas size explicitly', () => {
    const state = initAppState()

    const nextState = applyAgentActionToEditorState(state, {
      type: 'set_canvas_size',
      rows: 120,
      cols: 320,
    })

    expect(nextState.diagrams[0]?.data.canvasSize).toEqual({
      rows: 120,
      cols: 320,
    })
  })

  it('expands the canvas by the default deltas', () => {
    const state = initAppState()

    const nextState = applyAgentActionToEditorState(state, {
      type: 'expand_canvas',
    })

    expect(nextState.diagrams[0]?.data.canvasSize).toEqual({
      rows: 115,
      cols: 375,
    })
  })

  it('shrinks the canvas to fit shapes and portal views', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'shape-1',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 5, c: 10 },
          br: { r: 12, c: 29 },
          labelLines: [],
        },
      },
    ]
    state.diagrams[0]!.data.portalViews = [
      {
        id: 'portal-1',
        canvasId: state.activeDiagramId,
        label: 'Portal',
        rect: {
          top: 20,
          left: 40,
          width: 5,
          height: 6,
        },
        color: '#38bdf8',
        target: {
          documentId: null,
          canvasId: state.activeDiagramId,
          top: 20,
          left: 40,
        },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]

    const nextState = applyAgentActionToEditorState(state, {
      type: 'shrink_canvas_to_fit',
    })

    expect(nextState.diagrams[0]?.data.canvasSize).toEqual({
      rows: 26,
      cols: 45,
    })
  })

  it('moves shapes fully contained inside a moved portal', () => {
    const state = initAppState()
    const canvasId = state.activeDiagramId
    const portal: CanvasPortal = {
      id: 'portal-1',
      canvasId,
      label: 'Portal',
      color: '#38bdf8',
      createdAt: '2026-03-08T05:00:00.000Z',
      updatedAt: '2026-03-08T05:00:00.000Z',
      rect: {
        top: 4,
        left: 4,
        width: 12,
        height: 10,
      },
    }

    state.diagrams[0]!.data.shapes = [
      {
        id: 'inside-rect',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 6, c: 6 },
          br: { r: 8, c: 8 },
          labelLines: [],
        },
      },
      {
        id: 'inside-text',
        shape: {
          type: 'TEXT',
          start: { r: 10, c: 9 },
          lines: ['portal'],
        },
      },
      {
        id: 'outside-text',
        shape: {
          type: 'TEXT',
          start: { r: 20, c: 20 },
          lines: ['outside'],
        },
      },
    ]

    const moved = applyPortalMoveToEditorState(state, portal, {
      top: 7,
      left: 9,
      width: 12,
      height: 10,
    })

    const movedRect = moved.diagrams[0]!.data.shapes.find((shape) => shape.id === 'inside-rect')?.shape
    const movedText = moved.diagrams[0]!.data.shapes.find((shape) => shape.id === 'inside-text')?.shape
    const outsideText = moved.diagrams[0]!.data.shapes.find((shape) => shape.id === 'outside-text')?.shape

    expect(movedRect).toMatchObject({
      tl: { r: 9, c: 11 },
      br: { r: 11, c: 13 },
    })
    expect(movedText).toMatchObject({
      start: { r: 13, c: 14 },
    })
    expect(outsideText).toMatchObject({
      start: { r: 20, c: 20 },
    })
  })

  it('only moves portal contents for move-only updates', () => {
    const portal: CanvasPortal = {
      id: 'portal-1',
      canvasId: 'canvas-1',
      label: 'Portal',
      color: '#38bdf8',
      createdAt: '2026-03-08T05:00:00.000Z',
      updatedAt: '2026-03-08T05:00:00.000Z',
      rect: {
        top: 4,
        left: 4,
        width: 12,
        height: 10,
      },
    }

    expect(
      shouldMovePortalContents(portal, {
        top: 6,
        left: 7,
        width: 12,
        height: 10,
      }),
    ).toBe(true)

    expect(
      shouldMovePortalContents(portal, {
        top: 6,
        left: 7,
        width: 14,
        height: 10,
      }),
    ).toBe(false)

    expect(
      shouldMovePortalContents(portal, {
        top: 6,
        left: 7,
        width: 12,
        height: 10,
      }, false),
    ).toBe(false)
  })

  it('stores whole-canvas link grants', () => {
    const policy = createDefaultCanvasSharePolicy({
      ownerUserId: 'owner-1',
      ownerEmail: 'owner@example.com',
      updatedAt: '2026-03-08T05:00:00.000Z',
    })

    const nextPolicy = applyAgentActionToSharePolicy(policy, {
      type: 'share_canvas_link',
      token: 'share-token-1',
      access: 'edit',
    }, 'canvas-1')

    expect(nextPolicy.grants).toEqual([
      expect.objectContaining({
        subjectType: 'link',
        subjectId: 'share-token-1',
        access: 'edit',
        target: { type: 'canvas' },
      }),
    ])
  })

  it('allows multiple canvas access links', () => {
    const policy = createDefaultCanvasSharePolicy({
      ownerUserId: 'owner-1',
      ownerEmail: 'owner@example.com',
      updatedAt: '2026-03-08T05:00:00.000Z',
    })

    const withFirst = applyAgentActionToSharePolicy(policy, {
      type: 'share_canvas_link',
      token: 'share-token-1',
      access: 'view',
    }, 'canvas-1')

    const withSecond = applyAgentActionToSharePolicy(withFirst, {
      type: 'share_canvas_link',
      token: 'share-token-2',
      access: 'edit',
    }, 'canvas-1')

    expect(withSecond.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectId: 'share-token-1', target: { type: 'canvas' } }),
        expect.objectContaining({ subjectId: 'share-token-2', target: { type: 'canvas' } }),
      ]),
    )
  })

  it('removes canvas and portal link grants when unshared', () => {
    const policy = createDefaultCanvasSharePolicy({
      ownerUserId: 'owner-1',
      ownerEmail: 'owner@example.com',
      updatedAt: '2026-03-08T05:00:00.000Z',
    })

    const withLinks = applyAgentActionToSharePolicy(
      applyAgentActionToSharePolicy(policy, {
        type: 'share_canvas_link',
        token: 'canvas-token-1',
        access: 'view',
      }, 'canvas-1'),
      {
        type: 'share_portal_link',
        portalId: 'portal-1',
        token: 'portal-token-1',
        access: 'edit',
        allowCanvasView: true,
      },
      'canvas-1',
    )

    const withoutCanvasLink = applyAgentActionToSharePolicy(withLinks, {
      type: 'unshare_canvas_link',
      token: 'canvas-token-1',
    }, 'canvas-1')

    expect(
      withoutCanvasLink.grants.some((grant) => grant.subjectType === 'link' && grant.subjectId === 'canvas-token-1'),
    ).toBe(false)

    const withoutPortalLink = applyAgentActionToSharePolicy(withoutCanvasLink, {
      type: 'unshare_portal_link',
      portalId: 'portal-1',
      token: 'portal-token-1',
    }, 'canvas-1')

    expect(
      withoutPortalLink.grants.some((grant) => grant.subjectType === 'link' && grant.subjectId === 'portal-token-1'),
    ).toBe(false)
  })

  it('updates and revokes grants by id', () => {
    const policy = createDefaultCanvasSharePolicy({
      ownerUserId: 'owner-1',
      ownerEmail: 'owner@example.com',
      updatedAt: '2026-03-08T05:00:00.000Z',
    })

    const withPortalGrant = applyAgentActionToSharePolicy(policy, {
      type: 'share_portal',
      portalId: 'portal-1',
      email: 'person@example.com',
      access: 'view',
      allowCanvasView: true,
    }, 'canvas-1')

    const portalGrant = withPortalGrant.grants.find((grant) => grant.target.type === 'portal')!
    const canvasCompanionGrant = withPortalGrant.grants.find((grant) => grant.target.type === 'canvas')!

    const updated = applyAgentActionToSharePolicy(withPortalGrant, {
      type: 'update_grant',
      grantId: portalGrant.id,
      access: 'edit',
      allowCanvasView: false,
    }, 'canvas-1')

    expect(updated.grants.find((grant) => grant.id === portalGrant.id)?.access).toBe('edit')
    expect(updated.grants.some((grant) => grant.id === canvasCompanionGrant.id)).toBe(false)

    const revoked = applyAgentActionToSharePolicy(updated, {
      type: 'revoke_grant',
      grantId: portalGrant.id,
      revokeCompanionCanvasGrant: true,
    }, 'canvas-1')

    expect(revoked.grants.some((grant) => grant.id === portalGrant.id)).toBe(false)
  })
})
