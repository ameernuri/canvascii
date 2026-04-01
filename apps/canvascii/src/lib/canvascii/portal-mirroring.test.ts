import { describe, expect, it } from 'vitest'
import {
  createMirroredObjectId,
  createPortalMirrorCommands,
  type CanvasCommand,
  type CanvasDocument,
  type CanvasObject,
  type CanvasPortal,
} from '@canvascii/core'

function createDocument(objects: CanvasObject[]): CanvasDocument {
  return {
    id: 'doc-1',
    activeCanvasId: 'canvas-1',
    canvases: [
      {
        id: 'canvas-1',
        name: 'Canvas',
        bounds: { width: 200, height: 120 },
        defaultRenderMode: 'UNICODE',
        ownerActorId: null,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
        version: 1,
      },
    ],
    regions: [
      {
        id: 'canvas-1:root-region',
        canvasId: 'canvas-1',
        label: 'Canvas',
        rect: { top: 0, left: 0, width: 200, height: 120 },
        ownerActorId: null,
        permissionPolicyId: null,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
        version: 1,
      },
    ],
    objects,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    version: 1,
  }
}

function createTextObject(input: { id: string; row: number; col: number; lines?: string[] }): CanvasObject {
  return {
    id: input.id,
    canvasId: 'canvas-1',
    regionId: 'canvas-1:root-region',
    type: 'text',
    geometry: {
      type: 'text',
      start: {
        row: input.row,
        col: input.col,
      },
      lines: input.lines ?? ['hello'],
    },
    content: null,
    style: {},
    zIndex: 1,
    locked: false,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    version: 1,
  }
}

const sourcePortal: CanvasPortal = {
  id: 'portal-ameer',
  canvasId: 'canvas-1',
  label: '@ameer',
  rect: { top: 10, left: 10, width: 20, height: 10 },
  color: '#38bdf8',
  createdAt: '2026-03-08T00:00:00.000Z',
  updatedAt: '2026-03-08T00:00:00.000Z',
}

const targetPortal: CanvasPortal = {
  id: 'portal-codex',
  canvasId: 'canvas-1',
  label: '@codex',
  rect: { top: 40, left: 60, width: 20, height: 10 },
  color: '#f97316',
  createdAt: '2026-03-08T00:00:00.000Z',
  updatedAt: '2026-03-08T00:00:00.000Z',
}

describe('createPortalMirrorCommands', () => {
  it('mirrors object upserts from the source portal into the target portal', () => {
    const nextObject = createTextObject({
      id: 'obj-1',
      row: 12,
      col: 14,
      lines: ['mirrored'],
    })
    const commands = createPortalMirrorCommands({
      previousDocument: createDocument([]),
      nextDocument: createDocument([nextObject]),
      commands: [
        {
          id: 'cmd-1',
          type: 'object.upsert',
          actorId: 'human:ameer',
          at: '2026-03-08T01:00:00.000Z',
          input: {
            object: nextObject,
          },
        } satisfies CanvasCommand,
      ],
      sourcePortal,
      targetPortal,
      actorId: 'agent:codex',
    })

    expect(commands).toHaveLength(1)
    expect(commands[0]?.type).toBe('object.upsert')
    if (commands[0]?.type !== 'object.upsert') {
      throw new Error('Expected object.upsert command.')
    }
    expect(commands[0].input.object.id).toBe(createMirroredObjectId('obj-1', targetPortal.id))
    expect(commands[0].input.object.geometry).toEqual({
      type: 'text',
      start: { row: 42, col: 64 },
      lines: ['mirrored'],
    })
  })

  it('deletes the mirrored object when the source object leaves the source portal', () => {
    const previousObject = createTextObject({
      id: 'obj-2',
      row: 12,
      col: 14,
    })
    const nextObject = createTextObject({
      id: 'obj-2',
      row: 2,
      col: 4,
    })

    const commands = createPortalMirrorCommands({
      previousDocument: createDocument([previousObject]),
      nextDocument: createDocument([nextObject]),
      commands: [
        {
          id: 'cmd-2',
          type: 'object.upsert',
          actorId: 'human:ameer',
          at: '2026-03-08T01:00:00.000Z',
          input: {
            object: nextObject,
          },
        } satisfies CanvasCommand,
      ],
      sourcePortal,
      targetPortal,
      actorId: 'agent:codex',
    })

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'object.delete',
        input: {
          objectId: createMirroredObjectId('obj-2', targetPortal.id),
        },
      }),
    ])
  })

  it('deletes the mirrored object when the source object is deleted', () => {
    const previousObject = createTextObject({
      id: 'obj-3',
      row: 13,
      col: 15,
    })

    const commands = createPortalMirrorCommands({
      previousDocument: createDocument([previousObject]),
      nextDocument: createDocument([]),
      commands: [
        {
          id: 'cmd-3',
          type: 'object.delete',
          actorId: 'human:ameer',
          at: '2026-03-08T01:00:00.000Z',
          input: {
            objectId: 'obj-3',
          },
        } satisfies CanvasCommand,
      ],
      sourcePortal,
      targetPortal,
      actorId: 'agent:codex',
    })

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'object.delete',
        input: {
          objectId: createMirroredObjectId('obj-3', targetPortal.id),
        },
      }),
    ])
  })
})
