import { describe, expect, it } from 'vitest'
import { LIVE_CANVAS_COMMANDS } from '@canvascii/agent-client/command-language'
import { initAppState } from '@/components/asciip-core/store/appSlice'
import {
  buildTerminalPreview,
  executeTerminalCommand,
  TERMINAL_COMMANDS,
  parseCanvasToolCommand,
} from '@/lib/canvascii/terminal-commands'

describe('canvas terminal commands', () => {
  it('parses canvas.status through the shared live grammar', () => {
    const parsed = parseCanvasToolCommand('canvas.status', null)

    expect(parsed.canonicalInput).toBe('canvas.status')
    expect(parsed.command).toEqual({
      kind: 'canvas.status',
    })
  })

  it('parses canvas resize into an agent action', () => {
    const parsed = parseCanvasToolCommand('canvas.resize 120 320', null)

    expect(parsed.canonicalInput).toBe('canvas.resize rows=120 cols=320')
    expect(parsed.command).toEqual({
      kind: 'agent',
      action: {
        type: 'set_canvas_size',
        rows: 120,
        cols: 320,
      },
    })
  })

  it('uses the default canvas expand deltas when none are provided', () => {
    const parsed = parseCanvasToolCommand('canvas.expand', null)

    expect(parsed.canonicalInput).toBe('canvas.expand rows=40 cols=125')
    expect(parsed.command).toEqual({
      kind: 'agent',
      action: {
        type: 'expand_canvas',
        rows: 40,
        cols: 125,
      },
    })
  })

  it('executes canvas shrink through the shared terminal executor', () => {
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
    ]

    const parsed = parseCanvasToolCommand('canvas.shrink', null)
    const result = executeTerminalCommand(state, parsed.command)

    expect(result.nextState.diagrams[0]?.data.canvasSize).toEqual({
      rows: 7,
      cols: 15,
    })
  })

  it('previews the shrink target using current content bounds', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'rect-1',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 3, c: 8 },
          br: { r: 9, c: 18 },
          labelLines: [],
        },
      },
    ]

    expect(buildTerminalPreview('canvas.shrink', state, null)).toEqual({
      kind: 'rect',
      canvasId: state.activeDiagramId,
      top: 0,
      left: 0,
      width: 19,
      height: 10,
      label: 'Shrink canvas to 10 rows × 19 cols',
    })
  })

  it('keeps shared live command definitions in sync with the human terminal', () => {
    const terminalByName = new Map(TERMINAL_COMMANDS.map((command) => [command.name, command]))

    for (const command of LIVE_CANVAS_COMMANDS) {
      const terminalCommand = terminalByName.get(command.name)
      expect(terminalCommand, `Missing terminal command ${command.name}`).toBeTruthy()
      expect(terminalCommand?.canonicalUsage).toBe(command.canonicalUsage)
      expect(terminalCommand?.description).toBe(command.description)
    }
  })

  it('parses object.update into a semantic patch action', () => {
    const parsed = parseCanvasToolCommand('object.update target=selected top=10 left=20 width=12 height=5 body=\"Hello\"', 'rect-1')

    expect(parsed.canonicalInput).toBe('object.update target=selected top=10 left=20 width=12 height=5 body=\"Hello\"')
    expect(parsed.command).toEqual({
      kind: 'agent',
      action: {
        type: 'patch_object',
        objectId: 'rect-1',
        top: 10,
        left: 20,
        width: 12,
        height: 5,
        body: 'Hello',
      },
    })
  })

  it('executes objects.find against the local canvas state', () => {
    const state = initAppState()
    state.diagrams[0]!.data.shapes = [
      {
        id: 'rect-1',
        shape: {
          type: 'RECTANGLE',
          tl: { r: 2, c: 4 },
          br: { r: 6, c: 18 },
          labelLines: ['Overview'],
        },
      },
    ]

    const parsed = parseCanvasToolCommand('objects.find type=rectangle text=\"overview\"', null)
    const result = executeTerminalCommand(state, parsed.command)
    const output = JSON.parse(result.output ?? '[]')

    expect(output).toHaveLength(1)
    expect(output[0]?.id).toBe('rect-1')
  })
})
