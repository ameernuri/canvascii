import { describe, expect, it } from 'vitest'
import { initDiagramData, initDiagramState, type DiagramData } from './store/diagramSlice'
import { mergeExternalDiagramDataPreservingLocalDraft } from './asciip-editor-shell'

describe('mergeExternalDiagramDataPreservingLocalDraft', () => {
  it('preserves the locally edited text shape while applying remote canonical updates', () => {
    const localState = initDiagramState()
    localState.shapes = [
      {
        id: 'text-1',
        shape: {
          type: 'TEXT',
          start: { r: 10, c: 12 },
          lines: ['abc'],
        },
        style: undefined,
      },
      {
        id: 'rect-1',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 2, c: 2 },
          br: { r: 5, c: 8 },
          labelLines: [],
        },
        style: undefined,
      },
    ]
    localState.mode = {
      M: 'TEXT_EDIT',
      shapeId: 'text-1',
      startShape: {
        type: 'TEXT',
        start: { r: 10, c: 12 },
        lines: [],
      },
    }

    const remoteCanonical: DiagramData = initDiagramData({
      shapes: [
        {
          id: 'text-1',
          shape: {
            type: 'TEXT',
            start: { r: 10, c: 12 },
            lines: [],
          },
          style: undefined,
        },
        {
          id: 'rect-1',
          shape: {
            type: 'RECTANGLE',
            tl: { r: 20, c: 20 },
            br: { r: 24, c: 28 },
            labelLines: [],
          },
          style: undefined,
        },
      ],
    })

    const merged = mergeExternalDiagramDataPreservingLocalDraft(localState, remoteCanonical)

    expect(merged.shapes.find((shape) => shape.id === 'text-1')?.shape).toEqual({
      type: 'TEXT',
      start: { r: 10, c: 12 },
      lines: ['abc'],
    })
    expect(merged.shapes.find((shape) => shape.id === 'rect-1')?.shape).toEqual({
      type: 'RECTANGLE',
      tl: { r: 20, c: 20 },
      br: { r: 24, c: 28 },
      labelLines: [],
    })
  })
})
