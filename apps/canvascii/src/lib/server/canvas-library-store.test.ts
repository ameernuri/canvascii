import { randomUUID } from 'node:crypto'
import type { CanvasCommand } from '@canvascii/core'
import { afterEach, describe, expect, it } from 'vitest'
import { initAppState, type AppState } from '../../components/asciip-core/store/appSlice'
import { projectEditorStateThroughCommands } from '../canvascii/command-projection'
import { CanvasLibraryStore } from './canvas-library-store'
import { canvasciiPgPool } from './pg'

describe('CanvasLibraryStore command-backed saves', () => {
  const touchedOwners = new Set<string>()

  afterEach(async () => {
    if (touchedOwners.size === 0) {
      return
    }

    await canvasciiPgPool.query(
      `
        DELETE FROM canvases
        WHERE owner_user_id = ANY($1::text[])
      `,
      [Array.from(touchedOwners)],
    )
    touchedOwners.clear()
  })

  it('reuses provided command ids when updating an existing canvas', async () => {
    const store = new CanvasLibraryStore()
    const owner = {
      userId: `user-${randomUUID()}`,
      email: 'user@example.com',
    }
    touchedOwners.add(owner.userId)

    const initialState = initAppState()
    const created = await store.create(owner.userId, {
      name: 'demo',
      ownerEmail: owner.email,
      editorState: initialState as unknown as Record<string, unknown>,
    })

    const renamedState: AppState = {
      ...initialState,
      diagrams: initialState.diagrams.map((diagram) =>
        diagram.id === initialState.activeDiagramId
          ? {
              ...diagram,
              name: 'Renamed canvas',
            }
          : diagram,
      ),
    }

    const renameCommand: CanvasCommand = {
      id: 'cmd:client-rename',
      type: 'canvas.rename',
      actorId: null,
      at: '2026-03-07T12:00:00.000Z',
      input: {
        canvasId: initialState.activeDiagramId,
        name: 'Renamed canvas',
      },
    }

    await store.updateAccessible(owner, {
      id: created.id,
      editorState: renamedState as unknown as Record<string, unknown>,
      commands: [renameCommand],
      ifMatchEtag: created.etag,
    })

    const result = await canvasciiPgPool.query<{
      revision: number
      commands: CanvasCommand[]
      document: {
        canvases: Array<{ id: string; name: string }>
      }
    }>(
      `
        SELECT revision, commands, document
        FROM canvases
        WHERE id = $1
      `,
      [created.id],
    )

    const stored = result.rows[0]
    expect(stored.revision).toBe(2)
    expect(stored.commands.at(-1)?.id).toBe(renameCommand.id)
    expect(stored.commands.at(-1)?.type).toBe('canvas.rename')
    expect(stored.document.canvases.find((canvas) => canvas.id === initialState.activeDiagramId)?.name).toBe('Renamed canvas')
  })

  it('can create a new canvas record from a provided command batch', async () => {
    const store = new CanvasLibraryStore()
    const owner = {
      userId: `user-${randomUUID()}`,
      email: 'user2@example.com',
    }
    touchedOwners.add(owner.userId)

    const initialState = initAppState()
    const projection = projectEditorStateThroughCommands({
      previousDocument: null,
      editorState: initialState,
      documentId: 'doc:create-seeded',
      documentName: 'seeded.canvascii',
      updatedAt: '2026-03-07T12:05:00.000Z',
      actorId: owner.userId,
    })

    const created = await store.create(owner.userId, {
      name: 'seeded',
      ownerEmail: owner.email,
      editorState: initialState as unknown as Record<string, unknown>,
      commands: projection.commands,
    })

    const result = await canvasciiPgPool.query<{
      commands: CanvasCommand[]
      document: {
        activeCanvasId: string
        canvases: Array<{ id: string }>
      }
    }>(
      `
        SELECT commands, document
        FROM canvases
        WHERE id = $1
      `,
      [created.id],
    )

    const stored = result.rows[0]
    expect(stored.commands[0]?.id).toBe(projection.commands[0]?.id)
    expect(stored.document.activeCanvasId).toBe(initialState.activeDiagramId)
    expect(stored.document.canvases).toHaveLength(initialState.diagrams.length)
  })

  it('lists owned canvases through the database-backed access query', async () => {
    const store = new CanvasLibraryStore()
    const owner = {
      userId: `user-${randomUUID()}`,
      email: 'owner@example.com',
    }
    touchedOwners.add(owner.userId)

    await store.create(owner.userId, {
      name: 'library-visible',
      ownerEmail: owner.email,
      editorState: initAppState() as unknown as Record<string, unknown>,
    })

    const listed = await store.listAccessible(owner, { limit: 1000 })

    expect(listed.canvases.some((canvas) => canvas.storageKey === 'library-visible')).toBe(true)
  })
})
