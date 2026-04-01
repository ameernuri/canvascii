import { describe, expect, it, vi } from 'vitest'
import { CanvasciiAgentClient } from '@canvascii/agent-client'

describe('CanvasciiAgentClient behavior', () => {
  it('accepts agentName and agentColor aliases', () => {
    const client = new CanvasciiAgentClient({
      agentName: 'Alias Agent',
      agentColor: '#22c55e',
    })

    expect(client.name).toBe('Alias Agent')
    expect(client.color).toBe('#22c55e')
  })

  it('clears awareness presence on disconnect', () => {
    const client = new CanvasciiAgentClient()
    const setLocalState = vi.fn()
    const off = vi.fn()
    const disconnect = vi.fn()
    const destroy = vi.fn()

    client.provider = {
      awareness: { setLocalState },
      off,
      disconnect,
      destroy,
    } as any
    client.websocketProvider = {
      disconnect: vi.fn(),
    } as any
    client.pendingStatelessRequests = new Map()

    client.disconnect()

    expect(setLocalState).toHaveBeenCalledWith(null)
    expect(off).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
  })

  it('waits for the room document to become available after sync', async () => {
    const client = new CanvasciiAgentClient()
    let attempts = 0
    client.getDocument = vi.fn(() => {
      attempts += 1
      if (attempts < 3) {
        throw new Error('Room document is missing.')
      }
      return { activeCanvasId: 'canvas-1', version: 1 }
    }) as any

    const document = await client.waitForRoomDocument(500)

    expect(document).toEqual({ activeCanvasId: 'canvas-1', version: 1 })
    expect(attempts).toBeGreaterThanOrEqual(3)
  })

  it('filters stale agent collaborators from awareness reads', () => {
    const client = new CanvasciiAgentClient({
      canvasId: 'canvas-1',
    })
    client.provider = {
      awareness: {
        getStates: () =>
          new Map([
            [
              'fresh-agent',
              {
                presence: {
                  actorType: 'agent',
                  actorId: 'agent:fresh',
                  name: 'Fresh Agent',
                  updatedAt: new Date().toISOString(),
                  cursor: { canvasId: 'canvas-1', row: 1, col: 1 },
                },
              },
            ],
            [
              'stale-agent',
              {
                presence: {
                  actorType: 'agent',
                  actorId: 'agent:stale',
                  name: 'Stale Agent',
                  updatedAt: '2020-01-01T00:00:00.000Z',
                  cursor: { canvasId: 'canvas-1', row: 2, col: 2 },
                },
              },
            ],
            [
              'human-without-updated-at',
              {
                presence: {
                  actorType: 'human',
                  actorId: 'human:1',
                  name: 'Human User',
                  cursor: { canvasId: 'canvas-1', row: 3, col: 3 },
                },
              },
            ],
          ]),
      },
    } as any

    expect(client.listCollaborators({ canvasId: 'canvas-1' }).map((entry) => entry.name)).toEqual([
      'Fresh Agent',
      'Human User',
    ])
  })
})
