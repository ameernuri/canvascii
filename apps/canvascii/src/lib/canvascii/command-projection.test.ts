import { describe, expect, it } from 'vitest'
import { initAppState } from '@/components/asciip-core/store/appSlice'
import { projectDiagramStateTransitionThroughCommands } from '@/lib/canvascii/command-projection'

describe('projectDiagramStateTransitionThroughCommands', () => {
  it('emits direct object commands for active-canvas shape commits', () => {
    const initialState = initAppState()
    const previousDiagramData = initialState.diagrams[0].data
    const nextDiagramData = {
      ...previousDiagramData,
      shapes: [
        ...previousDiagramData.shapes,
        {
          id: 'shape-1',
          shape: {
            type: 'RECTANGLE' as const,
            tl: { r: 2, c: 4 },
            br: { r: 8, c: 18 },
          },
          style: { ...previousDiagramData.globalStyle },
        },
      ],
    }

    const projection = projectDiagramStateTransitionThroughCommands({
      appState: initialState,
      previousDiagramData,
      nextDiagramData,
      documentId: 'doc:projection-test',
      updatedAt: '2026-03-07T23:50:00.000Z',
      actorId: 'user-1',
    })

    expect(projection.commands.map((command) => command.type)).toContain('object.upsert')
    expect(projection.document.objects).toHaveLength(1)
    expect(projection.document.canvases).toHaveLength(initialState.diagrams.length)
  })
})
