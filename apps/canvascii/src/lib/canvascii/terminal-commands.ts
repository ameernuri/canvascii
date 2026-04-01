import type { CanvasCommand } from '@canvascii/core'
import {
  buildLiveCanvasCommandPreview,
  LIVE_CANVAS_COMMANDS,
  parseLiveCanvasCommand,
} from '@canvascii/agent-client/command-language'
import {
  buildStructureCanvasCommandPreview,
  CANVAS_STRUCTURE_COMMANDS,
  executeStructureCanvasCommand,
  getStructureCanvasCommandHelp,
  isStructureCanvasCommandName,
  parseStructureCanvasCommand,
} from '@canvascii/agent-client/structure-command-language'
import { getBoundingBoxOfAll } from '@/components/asciip-core/models/shapeInCanvas'
import { translateUnbounded } from '@/components/asciip-core/models/transformation'
import { getStyledCanvasGrid } from '@/components/asciip-core/models/representation'
import type { ShapeObject } from '@/components/asciip-core/store/diagramSlice'
import { initDiagramData } from '@/components/asciip-core/store/diagramSlice'
import type { AppState, ComponentAttribute, Diagram } from '@/components/asciip-core/store/appSlice'
import type { EditorTerminalPreview } from '@/lib/canvascii/collaboration'
import { createComponentView } from '@/lib/canvascii/live-portals'
import {
  applyAgentActionToEditorState,
  doesShapeObjectIntersectRegion,
  serializeShapeObjectAsAgentSpec,
  type CanvasAgentAction,
  type CanvasAgentObjectSpec,
} from '@/lib/canvascii/agent-edit'

/**
 * The terminal grammar should be explicit enough for agents and forgiving enough for humans.
 * We keep one canonical keyed syntax, while still accepting the older positional aliases.
 */
export type TerminalCommandDefinition = {
  name: string
  canonicalUsage: string
  aliases?: string[]
  description: string
}

export const TERMINAL_COMMANDS: TerminalCommandDefinition[] = [
  {
    name: 'canvas.status',
    canonicalUsage: 'canvas.status',
    aliases: ['canvas.status'],
    description: 'Report live room readiness, active canvas identity, and visible collaborators.',
  },
  {
    name: 'box.create',
    canonicalUsage: 'box.create top=5 left=100 width=50 height=20 title="Header" body="Body"',
    aliases: ['box.create 5 100 50 20 label="Header" text="Body"'],
    description: 'Create a box with optional border title and body text.',
  },
  {
    name: 'box.title',
    canonicalUsage: 'box.title target=selected title="Header"',
    aliases: ['box.title selected Header'],
    description: 'Set the border title on an existing box.',
  },
  {
    name: 'box.body',
    canonicalUsage: 'box.body target=selected body="Body text"',
    aliases: ['text.set selected Body text'],
    description: 'Replace the inner body text of an existing box.',
  },
  {
    name: 'text.create',
    canonicalUsage: 'text.create row=5 col=12 text="Hello world"',
    aliases: ['text.create 5 12 Hello world'],
    description: 'Create a free text item at an exact grid coordinate.',
  },
  {
    name: 'line.create',
    canonicalUsage: 'line.create fromRow=5 fromCol=12 toRow=5 toCol=32',
    aliases: ['line.create 5 12 5 32'],
    description: 'Create a straight connector between two points.',
  },
  {
    name: 'canvas.read',
    canonicalUsage: 'canvas.read top=0 left=0 width=80 height=20',
    aliases: ['canvas.read 0 0 80 20'],
    description: 'Read one region as rendered text plus round-trippable JSON specs.',
  },
  {
    name: 'canvas.resize',
    canonicalUsage: 'canvas.resize rows=120 cols=320',
    aliases: ['canvas.resize 120 320'],
    description: 'Set the root canvas size explicitly.',
  },
  {
    name: 'canvas.expand',
    canonicalUsage: 'canvas.expand rows=40 cols=125',
    aliases: ['canvas.expand 40 125', 'canvas.expand'],
    description: 'Grow the root canvas by row/column deltas.',
  },
  {
    name: 'canvas.shrink',
    canonicalUsage: 'canvas.shrink',
    aliases: ['canvas.shrink'],
    description: 'Shrink the root canvas to fit the current content bounds.',
  },
  {
    name: 'canvas.apply',
    canonicalUsage:
      `canvas.apply mode=upsert json='[{\"type\":\"rectangle\",\"top\":5,\"left\":10,\"width\":20,\"height\":8,\"label\":\"Header\"}]'`,
    aliases: [
      `canvas.apply json='[{\"type\":\"text\",\"row\":5,\"col\":10,\"text\":\"Hello\"}]'`,
    ],
    description: 'Apply a whole JSON drawing payload in one live submission.',
  },
  {
    name: 'objects.move',
    canonicalUsage: 'objects.move ids="id-1,id-2" deltaRow=4 deltaCol=10',
    aliases: ['objects.move id-1,id-2 4 10'],
    description: 'Move several objects together in one batch.',
  },
  {
    name: 'objects.find',
    canonicalUsage: 'objects.find type=rectangle text="Overview" withinTop=0 withinLeft=0 withinWidth=80 withinHeight=20',
    aliases: ['objects.find type=rectangle text="Overview"'],
    description: 'Find live objects by semantic query instead of relying on stale ids.',
  },
  {
    name: 'object.update',
    canonicalUsage: 'object.update target=selected top=20 left=40 width=12 height=6 title="Header" body="Body"',
    aliases: ['object.update selected top=20 left=40 body="Body"'],
    description: 'Patch one object in place without recreating the whole region.',
  },
  {
    name: 'objects.replace',
    canonicalUsage: 'objects.replace ids="id-1,id-2" json="[{\"type\":\"rectangle\",\"top\":5,\"left\":10,\"width\":20,\"height\":8}]"',
    aliases: ['objects.replace ids="id-1" json="[]"'],
    description: 'Delete the exact objects you name, then draw the replacement set in one batch.',
  },
  {
    name: 'stack.pack',
    canonicalUsage: 'stack.pack ids="id-1,id-2,id-3" axis=vertical gap=shared align=start',
    aliases: ['stack.pack ids="id-1,id-2" axis=horizontal gap=2'],
    description: 'Pack objects into a vertical or horizontal stack with optional shared borders.',
  },
  {
    name: 'objects.align',
    canonicalUsage: 'objects.align ids="id-1,id-2" edge=left',
    aliases: ['objects.align ids="id-1,id-2" edge=hcenter'],
    description: 'Align a set of objects to one edge or center line.',
  },
  {
    name: 'object.move',
    canonicalUsage: 'object.move target=selected top=20 left=40',
    aliases: ['object.move selected 20 40'],
    description: 'Move an object to exact coordinates.',
  },
  {
    name: 'object.resize',
    canonicalUsage: 'object.resize target=selected top=20 left=40 width=12 height=6',
    aliases: ['object.resize selected 20 40 12 6'],
    description: 'Resize an object to exact bounds.',
  },
  {
    name: 'object.delete',
    canonicalUsage: 'object.delete target=selected',
    aliases: ['object.delete selected'],
    description: 'Delete an object by id or current selection.',
  },
  {
    name: 'text.set',
    canonicalUsage: 'text.set target=selected text="Hello world"',
    aliases: ['text.set selected Hello world'],
    description: 'Replace generic text on a text object or connector label.',
  },
  {
    name: 'text.align',
    canonicalUsage: 'text.align target=selected align=center',
    aliases: ['text.align selected center'],
    description: 'Align text horizontally.',
  },
  {
    name: 'text.enclose',
    canonicalUsage: 'text.enclose target=selected padding=1',
    aliases: ['text.enclose selected 1'],
    description: 'Wrap a text item in a wireframe box.',
  },
  ...CANVAS_STRUCTURE_COMMANDS,
] as const

export type TerminalCommand =
  | { kind: 'canvas.status' }
  | {
      kind: 'canvas.read'
      top: number
      left: number
      width: number
      height: number
    }
  | {
      kind: 'canvas.apply'
      mode: 'upsert' | 'replace-region'
      objects: CanvasAgentObjectSpec[]
      top?: number
      left?: number
      width?: number
      height?: number
      clearTypes?: CanvasAgentObjectSpec['type'][]
    }
  | {
      kind: 'objects.move'
      objectIds: string[]
      deltaRow: number
      deltaCol: number
    }
  | {
      kind: 'objects.find'
      objectType?: string
      objectTypes?: string[]
      textContains?: string
      labelContains?: string
      withinTop?: number
      withinLeft?: number
      withinWidth?: number
      withinHeight?: number
    }
  | { kind: 'agent'; action: CanvasAgentAction }
  | { kind: 'page.new'; name: string | null }
  | { kind: 'page.open'; query: string }
  | { kind: 'page.list' }
  | { kind: 'group.create' }
  | { kind: 'group.break' }
  | { kind: 'component.mark' }
  | { kind: 'component.create'; name: string | null }
  | { kind: 'component.attr.upsert'; key: string; defaultValue: string }
  | { kind: 'component.attr.remove'; key: string }
  | { kind: 'component.use'; query: string; top: number; left: number; props: Record<string, string> }

export type ParsedTerminalCommand = {
  definition: TerminalCommandDefinition
  syntaxStyle: 'canonical' | 'legacy'
  canonicalInput: string
  command: TerminalCommand
}

export type TerminalExecutionResult = {
  nextState: AppState
  message: string
  output?: string
}

function parseCommandText(value: string) {
  return value.replace(/\\n/g, '\n')
}

function quoteCommandValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
}

function createClientCanvasId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getActivePage(state: AppState) {
  return state.diagrams.find((diagram) => diagram.id === state.activeDiagramId) ?? state.diagrams[0]
}

export function getChildPages(state: AppState, parentCanvasId: string | null) {
  return state.diagrams.filter((diagram) => (diagram.parentCanvasId ?? null) === parentCanvasId)
}

export function getPageAncestors(state: AppState, canvasId: string) {
  const byId = new Map(state.diagrams.map((diagram) => [diagram.id, diagram]))
  const trail: Diagram[] = []
  let cursor = byId.get(canvasId) ?? null
  while (cursor) {
    trail.unshift(cursor)
    cursor = cursor.parentCanvasId ? byId.get(cursor.parentCanvasId) ?? null : null
  }
  return trail
}

function getDiagramContentBounds(diagram: Diagram) {
  const shapeBounds = getBoundingBoxOfAll(diagram.data.shapes.map((shapeObj) => shapeObj.shape))
  const portalBounds = diagram.data.portalViews.length > 0
    ? {
        top: Math.min(...diagram.data.portalViews.map((portal) => portal.rect.top)),
        left: Math.min(...diagram.data.portalViews.map((portal) => portal.rect.left)),
        bottom: Math.max(...diagram.data.portalViews.map((portal) => portal.rect.top + portal.rect.height - 1)),
        right: Math.max(...diagram.data.portalViews.map((portal) => portal.rect.left + portal.rect.width - 1)),
      }
    : null

  if (shapeBounds && portalBounds) {
    return {
      top: Math.min(shapeBounds.top, portalBounds.top),
      left: Math.min(shapeBounds.left, portalBounds.left),
      bottom: Math.max(shapeBounds.bottom, portalBounds.bottom),
      right: Math.max(shapeBounds.right, portalBounds.right),
    }
  }

  return shapeBounds ?? portalBounds
}

function getDiagramShrinkToFitCanvasSize(diagram: Diagram) {
  const bounds = getDiagramContentBounds(diagram)
  if (!bounds) {
    const defaults = initDiagramData().canvasSize
    return {
      rows: Math.min(diagram.data.canvasSize.rows, defaults.rows),
      cols: Math.min(diagram.data.canvasSize.cols, defaults.cols),
    }
  }

  return {
    rows: Math.max(1, bounds.bottom + 1),
    cols: Math.max(1, bounds.right + 1),
  }
}

/**
 * Pages are addressable by visible index, id, or fuzzy name match.
 * This is intentionally human-friendly because the terminal is used interactively.
 */
export function resolvePageMatch(state: AppState, query: string) {
  const clean = query.trim()
  if (!clean) return null

  const numericIndex = Number.parseInt(clean, 10)
  if (Number.isFinite(numericIndex) && numericIndex >= 1 && numericIndex <= state.diagrams.length) {
    return state.diagrams[numericIndex - 1] ?? null
  }

  const lower = clean.toLowerCase()
  return (
    state.diagrams.find((diagram) => diagram.id === clean) ??
    state.diagrams.find((diagram) => diagram.name.toLowerCase() === lower) ??
    state.diagrams.find((diagram) => diagram.name.toLowerCase().includes(lower)) ??
    null
  )
}

/**
 * Component props use simple {{name}} placeholders. This helper scans extracted
 * shapes and auto-seeds those attributes so the generated component is immediately useful.
 */
function collectComponentAttributeKeys(shapes: ShapeObject[]) {
  const keys = new Set<string>()
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g
  for (const shapeObj of shapes) {
    const textSources =
      shapeObj.shape.type === 'TEXT'
        ? shapeObj.shape.lines ?? []
        : shapeObj.shape.type === 'RECTANGLE'
          ? [shapeObj.shape.label ?? '', ...(shapeObj.shape.labelLines ?? [])]
          : shapeObj.shape.type === 'LINE' || shapeObj.shape.type === 'MULTI_SEGMENT_LINE'
            ? shapeObj.shape.labelLines ?? []
            : []
    for (const source of textSources) {
      for (const match of source.matchAll(pattern)) {
        if (match[1]) {
          keys.add(match[1])
        }
      }
    }
  }
  return [...keys]
}

function removeShapeIdsFromGroups(groups: AppState['diagrams'][number]['data']['groups'], shapeIds: Set<string>) {
  return groups
    .map((group) => ({
      ...group,
      shapeIds: group.shapeIds.filter((shapeId) => !shapeIds.has(shapeId)),
    }))
    .filter((group) => group.shapeIds.length > 1)
}

function extractSelectionToComponent(
  state: AppState,
  selectedObjectIds: string[],
  name?: string | null,
) {
  if (selectedObjectIds.length === 0) {
    throw new Error('Select one or more objects before creating a component.')
  }

  const activePage = getActivePage(state)
  const selectedIdSet = new Set(selectedObjectIds)
  const selectedShapes = activePage.data.shapes.filter((shapeObj) => selectedIdSet.has(shapeObj.id))
  const bounds = getBoundingBoxOfAll(selectedShapes.map((shapeObj) => shapeObj.shape))
  if (!bounds) {
    throw new Error('The current selection has no drawable bounds.')
  }

  const nextComponentId = createClientCanvasId()
  const normalizedShapes = selectedShapes.map((shapeObj) => ({
    ...shapeObj,
    shape: translateUnbounded(shapeObj.shape, {
      r: -bounds.top,
      c: -bounds.left,
    }),
  }))
  const componentAttributes: ComponentAttribute[] = collectComponentAttributeKeys(selectedShapes).map((key) => ({
    key,
    defaultValue: '',
  }))
  const componentName =
    name?.trim() || `Component ${state.diagrams.filter((diagram) => diagram.kind === 'component').length + 1}`

  const componentView = createComponentView({
    canvasId: activePage.id,
    sourceCanvasId: nextComponentId,
    label: componentName,
    rect: {
      top: bounds.top,
      left: bounds.left,
      width: bounds.right - bounds.left + 1,
      height: bounds.bottom - bounds.top + 1,
    },
  })

  const nextComponentPage: Diagram = {
    id: nextComponentId,
    name: componentName,
    parentCanvasId: activePage.id,
    kind: 'component',
    sourceCanvasId: null,
    componentAttributes,
    data: initDiagramData({
      canvasSize: {
        rows: bounds.bottom - bounds.top + 1,
        cols: bounds.right - bounds.left + 1,
      },
      shapes: normalizedShapes,
      groups: activePage.data.groups.filter((group) => group.shapeIds.every((shapeId) => selectedIdSet.has(shapeId))),
      portalViews: [],
      styleMode: activePage.data.styleMode,
      globalStyle: activePage.data.globalStyle,
    }),
  }

  const nextState: AppState = {
    ...state,
    diagrams: state.diagrams.flatMap((diagram) => {
      if (diagram.id !== activePage.id) {
        return [diagram]
      }
      return [
        {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: diagram.data.shapes.filter((shapeObj) => !selectedIdSet.has(shapeObj.id)),
            groups: removeShapeIdsFromGroups(diagram.data.groups, selectedIdSet),
            portalViews: [...diagram.data.portalViews, componentView],
          },
        },
        nextComponentPage,
      ]
    }),
    activeDiagramId: activePage.id,
  }

  return {
    nextState,
    componentName,
    attributeCount: componentAttributes.length,
  }
}

function parseNamedStringArgs(value: string) {
  const props: Record<string, string> = {}
  const pattern = /([\w.-]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g

  for (const match of value.matchAll(pattern)) {
    const key = match[1]
    const raw = match[2]
    if (!key || !raw) continue
    const unquoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    props[key] = parseCommandText(unquoted.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
  }

  return props
}

function getLeadingNumbers(input: string) {
  const matches = input.match(/-?\d+/g) ?? []
  return matches.map((value) => Number(value))
}

function resolveCommandTarget(targetToken: string, selectedObjectId: string | null) {
  if (targetToken === 'selected') {
    if (!selectedObjectId) {
      throw new Error('Select an object first, or provide an explicit object id.')
    }
    return selectedObjectId
  }
  return targetToken
}

function isSharedLiveCommandName(commandName: string) {
  return LIVE_CANVAS_COMMANDS.some((command) => command.name === commandName)
}

function adaptParsedLiveCommand(parsed: any, selectedObjectId: string | null): ParsedTerminalCommand {
  const command = parsed.command
  const withResolvedTarget = (targetToken: string) => resolveCommandTarget(targetToken, selectedObjectId)
  let nextCommand: TerminalCommand

  switch (command.type) {
    case 'canvas.status':
      nextCommand = { kind: 'canvas.status' }
      break
    case 'box.create':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'create_rectangle',
          top: command.top,
          left: command.left,
          width: command.width,
          height: command.height,
          ...(command.title ? { label: command.title } : {}),
          ...(command.body ? { labelLines: String(command.body).split('\n') } : {}),
        },
      }
      break
    case 'box.title':
      nextCommand = {
        kind: 'agent',
        action: { type: 'set_rectangle_label', objectId: withResolvedTarget(command.target), label: command.title },
      }
      break
    case 'box.body':
    case 'text.set':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'set_text',
          objectId: withResolvedTarget(command.target),
          lines: String(command.text).split('\n'),
        },
      }
      break
    case 'text.create':
      nextCommand = {
        kind: 'agent',
        action: { type: 'create_text', row: command.row, col: command.col, lines: String(command.text).split('\n') },
      }
      break
    case 'line.create':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'create_line',
          from: { row: command.fromRow, col: command.fromCol },
          to: { row: command.toRow, col: command.toCol },
        },
      }
      break
    case 'canvas.read':
      nextCommand = { kind: 'canvas.read', top: command.top, left: command.left, width: command.width, height: command.height }
      break
    case 'canvas.apply':
      nextCommand = {
        kind: 'canvas.apply',
        mode: command.mode,
        objects: command.objects,
        ...(command.top != null ? { top: command.top } : {}),
        ...(command.left != null ? { left: command.left } : {}),
        ...(command.width != null ? { width: command.width } : {}),
        ...(command.height != null ? { height: command.height } : {}),
        ...(command.clearTypes?.length ? { clearTypes: command.clearTypes } : {}),
      }
      break
    case 'canvas.resize':
      nextCommand = { kind: 'agent', action: { type: 'set_canvas_size', rows: command.rows, cols: command.cols } }
      break
    case 'canvas.expand':
      nextCommand = { kind: 'agent', action: { type: 'expand_canvas', rows: command.rows, cols: command.cols } }
      break
    case 'canvas.shrink':
      nextCommand = { kind: 'agent', action: { type: 'shrink_canvas_to_fit' } }
      break
    case 'objects.move':
      nextCommand = { kind: 'objects.move', objectIds: command.objectIds, deltaRow: command.deltaRow, deltaCol: command.deltaCol }
      break
    case 'objects.find':
      nextCommand = {
        kind: 'objects.find',
        ...(command.objectType ? { objectType: command.objectType } : {}),
        ...(command.objectTypes?.length ? { objectTypes: command.objectTypes } : {}),
        ...(command.textContains ? { textContains: command.textContains } : {}),
        ...(command.labelContains ? { labelContains: command.labelContains } : {}),
        ...(command.withinTop != null ? { withinTop: command.withinTop } : {}),
        ...(command.withinLeft != null ? { withinLeft: command.withinLeft } : {}),
        ...(command.withinWidth != null ? { withinWidth: command.withinWidth } : {}),
        ...(command.withinHeight != null ? { withinHeight: command.withinHeight } : {}),
      }
      break
    case 'object.update':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'patch_object',
          objectId: withResolvedTarget(command.target),
          ...(command.top != null ? { top: command.top } : {}),
          ...(command.left != null ? { left: command.left } : {}),
          ...(command.width != null ? { width: command.width } : {}),
          ...(command.height != null ? { height: command.height } : {}),
          ...(command.row != null ? { row: command.row } : {}),
          ...(command.col != null ? { col: command.col } : {}),
          ...(command.title != null ? { title: command.title } : {}),
          ...(command.text != null ? { text: command.text } : {}),
          ...(command.body != null ? { body: command.body } : {}),
          ...(command.alignment ? { alignment: command.alignment } : {}),
        },
      }
      break
    case 'objects.replace':
      nextCommand = { kind: 'agent', action: { type: 'replace_objects', objectIds: command.objectIds, objects: command.objects } }
      break
    case 'stack.pack':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'pack_objects',
          objectIds: command.objectIds,
          axis: command.axis,
          gap: command.gap === 'shared' ? -1 : command.gap,
          align: command.align,
        },
      }
      break
    case 'objects.align':
      nextCommand = { kind: 'agent', action: { type: 'align_objects', objectIds: command.objectIds, edge: command.edge } }
      break
    case 'object.move':
      nextCommand = { kind: 'agent', action: { type: 'move_object', objectId: withResolvedTarget(command.target), top: command.top, left: command.left } }
      break
    case 'object.resize':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'resize_object',
          objectId: withResolvedTarget(command.target),
          top: command.top,
          left: command.left,
          width: command.width,
          height: command.height,
        },
      }
      break
    case 'object.delete':
      nextCommand = { kind: 'agent', action: { type: 'delete_object', objectId: withResolvedTarget(command.target) } }
      break
    case 'text.align':
      nextCommand = {
        kind: 'agent',
        action: { type: 'set_text_alignment', objectId: withResolvedTarget(command.target), alignment: command.alignment },
      }
      break
    case 'text.enclose':
      nextCommand = {
        kind: 'agent',
        action: {
          type: 'enclose_text',
          objectId: withResolvedTarget(command.target),
          ...(command.padding != null ? { padding: command.padding } : {}),
        },
      }
      break
    default:
      throw new Error(`Unsupported shared live command: ${command.type}`)
  }

  return {
    definition: parsed.definition,
    syntaxStyle: parsed.syntaxStyle,
    canonicalInput: parsed.canonicalInput,
    command: nextCommand,
  }
}

function ensureNumber(value: string | undefined, label: string) {
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${label}.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`)
  }
  return parsed
}

function ensurePositiveNumber(value: string | undefined, label: string) {
  const parsed = ensureNumber(value, label)
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than 0.`)
  }
  return parsed
}

function ensureIntegerFromInput(value: unknown, label: string) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer.`)
  }
  return parsed
}

function getSpecBounds(spec: CanvasAgentObjectSpec) {
  switch (spec.type) {
    case 'rectangle':
      return {
        top: spec.top,
        left: spec.left,
        width: spec.width,
        height: spec.height,
        right: spec.left + spec.width - 1,
        bottom: spec.top + spec.height - 1,
      }
    case 'text': {
      const lines = spec.lines ?? (typeof spec.text === 'string' ? spec.text.split('\n') : [''])
      const width = Math.max(1, ...lines.map((line) => Array.from(line).length))
      return {
        top: spec.row,
        left: spec.col,
        width,
        height: Math.max(1, lines.length),
        right: spec.col + width - 1,
        bottom: spec.row + Math.max(1, lines.length) - 1,
      }
    }
    case 'line': {
      const top = Math.min(spec.from.row, spec.to.row)
      const left = Math.min(spec.from.col, spec.to.col)
      const right = Math.max(spec.from.col, spec.to.col)
      const bottom = Math.max(spec.from.row, spec.to.row)
      return { top, left, width: right - left + 1, height: bottom - top + 1, right, bottom }
    }
    case 'path': {
      const top = Math.min(...spec.points.map((point) => point.row))
      const left = Math.min(...spec.points.map((point) => point.col))
      const right = Math.max(...spec.points.map((point) => point.col))
      const bottom = Math.max(...spec.points.map((point) => point.row))
      return { top, left, width: right - left + 1, height: bottom - top + 1, right, bottom }
    }
  }
}

function parseJsonSpecs(raw: string | undefined) {
  if (!raw) {
    throw new Error('Missing json payload.')
  }
  let parsed = null
  try {
    parsed = JSON.parse(parseCommandText(raw))
  } catch (error) {
    throw new Error(`Invalid json payload: ${error instanceof Error ? error.message : 'parse error'}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('json must be an array of object specs.')
  }
  return parsed as CanvasAgentObjectSpec[]
}

function renderRegionText(diagram: Diagram, region: { top: number; left: number; width: number; height: number }) {
  const grid = getStyledCanvasGrid(diagram.data.canvasSize, diagram.data.shapes, {
    styleMode: diagram.data.styleMode,
    globalStyle: diagram.data.globalStyle,
  })
  const bottom = region.top + region.height - 1
  const right = region.left + region.width - 1
  return grid
    .slice(region.top, bottom + 1)
    .map((row) => row.slice(region.left, right + 1).join('').replace(/\s+$/, ''))
    .join('\n')
}

function buildLocalCanvasRegionSnapshot(state: AppState, canvasId: string, region: { top: number; left: number; width: number; height: number }) {
  const diagram = state.diagrams.find((entry) => entry.id === canvasId)
  if (!diagram) {
    throw new Error(`Canvas ${canvasId} not found.`)
  }

  const shapes = diagram.data.shapes.filter((shapeObj) => doesShapeObjectIntersectRegion(shapeObj, region))
  return {
    canvasId,
    region,
    objectCount: shapes.length,
    specs: shapes.map(serializeShapeObjectAsAgentSpec),
    rendered: renderRegionText(diagram, region),
  }
}

function findDefinition(name: string) {
  return TERMINAL_COMMANDS.find((command) => command.name === name)
}

export function getTerminalCommandHelp(input: string) {
  const value = input.trim().toLowerCase()
  if (!value) return TERMINAL_COMMANDS
  const liveMatches = TERMINAL_COMMANDS.filter(
    (command) =>
      command.name.startsWith(value) ||
      command.canonicalUsage.toLowerCase().includes(value) ||
      command.aliases?.some((alias) => alias.toLowerCase().includes(value)) ||
      command.description.toLowerCase().includes(value),
  )
  if (liveMatches.length > 0) {
    return liveMatches
  }
  return getStructureCanvasCommandHelp(value) as TerminalCommandDefinition[]
}

/**
 * Parse either the canonical keyed syntax or the older positional aliases.
 * The return value always includes the normalized canonical command string so the UI
 * can show the user exactly what will be executed.
 */
export function parseCanvasToolCommand(input: string, selectedObjectId: string | null): ParsedTerminalCommand {
  const value = input.trim()
  const commandName = value.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const rest = value.slice(commandName.length).trim()
  const named = parseNamedStringArgs(rest)
  let match: RegExpMatchArray | null = null

  if (isStructureCanvasCommandName(commandName)) {
    return parseStructureCanvasCommand(value) as ParsedTerminalCommand
  }

  if (isSharedLiveCommandName(commandName)) {
    return adaptParsedLiveCommand(parseLiveCanvasCommand(value), selectedObjectId)
  }

  if (commandName === 'box.create') {
    if ('top' in named || 'left' in named || 'width' in named || 'height' in named) {
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const width = ensurePositiveNumber(named.width, 'width')
      const height = ensurePositiveNumber(named.height, 'height')
      const title = named.title ?? named.label
      const body = named.body ?? named.text
      return {
        definition: findDefinition('box.create')!,
        syntaxStyle: 'canonical',
        canonicalInput: `box.create top=${top} left=${left} width=${width} height=${height}${title ? ` title=${quoteCommandValue(title)}` : ''}${body ? ` body=${quoteCommandValue(body)}` : ''}`,
        command: {
          kind: 'agent',
          action: {
            type: 'create_rectangle',
            top,
            left,
            width,
            height,
            ...(title ? { label: title } : {}),
            ...(body ? { labelLines: body.split('\n') } : {}),
          },
        },
      }
    }

    match = value.match(/^box\.create\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)(?:\s+label="([^"]*)")?(?:\s+text="([^"]*)")?\s*$/i)
    if (match) {
      const top = Number(match[1])
      const left = Number(match[2])
      const width = Number(match[3])
      const height = Number(match[4])
      const title = match[5] ? parseCommandText(match[5]) : ''
      const body = match[6] ? parseCommandText(match[6]) : ''
      return {
        definition: findDefinition('box.create')!,
        syntaxStyle: 'legacy',
        canonicalInput: `box.create top=${top} left=${left} width=${width} height=${height}${title ? ` title=${quoteCommandValue(title)}` : ''}${body ? ` body=${quoteCommandValue(body)}` : ''}`,
        command: {
          kind: 'agent',
          action: {
            type: 'create_rectangle',
            top,
            left,
            width,
            height,
            ...(title ? { label: title } : {}),
            ...(body ? { labelLines: body.split('\n') } : {}),
          },
        },
      }
    }
  }

  if (commandName === 'canvas.status') {
    return {
      definition: TERMINAL_COMMANDS.find((command) => command.name === 'canvas.status')!,
      syntaxStyle: 'canonical',
      canonicalInput: 'canvas.status',
      command: { kind: 'canvas.status' },
    }
  }

  if (commandName === 'box.title') {
    if ('target' in named || 'title' in named) {
      const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
      const title = named.title ?? named.label
      if (!title) {
        throw new Error('Missing title.')
      }
      return {
        definition: findDefinition('box.title')!,
        syntaxStyle: 'canonical',
        canonicalInput: `box.title target=${target === selectedObjectId ? 'selected' : target} title=${quoteCommandValue(title)}`,
        command: {
          kind: 'agent',
          action: { type: 'set_rectangle_label', objectId: target, label: title },
        },
      }
    }

    match = value.match(/^box\.title\s+(\S+)\s+(.+)$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      const title = parseCommandText(match[2])
      return {
        definition: findDefinition('box.title')!,
        syntaxStyle: 'legacy',
        canonicalInput: `box.title target=${target === selectedObjectId ? 'selected' : target} title=${quoteCommandValue(title)}`,
        command: {
          kind: 'agent',
          action: { type: 'set_rectangle_label', objectId: target, label: title },
        },
      }
    }
  }

  if (commandName === 'box.body' || commandName === 'text.set') {
    const definition = findDefinition(commandName === 'box.body' ? 'box.body' : 'text.set')!
    if ('target' in named || 'body' in named || 'text' in named) {
      const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
      const text = named.body ?? named.text
      if (!text) {
        throw new Error('Missing text.')
      }
      return {
        definition,
        syntaxStyle: 'canonical',
        canonicalInput: `${commandName === 'box.body' ? 'box.body' : 'text.set'} target=${target === selectedObjectId ? 'selected' : target} ${commandName === 'box.body' ? 'body' : 'text'}=${quoteCommandValue(text)}`,
        command: {
          kind: 'agent',
          action: { type: 'set_text', objectId: target, lines: text.split('\n') },
        },
      }
    }

    match = value.match(/^(?:box\.body|text\.set)\s+(\S+)\s+(.+)$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      const text = parseCommandText(match[2])
      return {
        definition,
        syntaxStyle: 'legacy',
        canonicalInput: `${commandName === 'box.body' ? 'box.body' : 'text.set'} target=${target === selectedObjectId ? 'selected' : target} ${commandName === 'box.body' ? 'body' : 'text'}=${quoteCommandValue(text)}`,
        command: {
          kind: 'agent',
          action: { type: 'set_text', objectId: target, lines: text.split('\n') },
        },
      }
    }
  }

  if (commandName === 'text.create') {
    if ('row' in named || 'col' in named || 'text' in named) {
      const row = ensureNumber(named.row, 'row')
      const col = ensureNumber(named.col, 'col')
      const text = named.text
      if (!text) {
        throw new Error('Missing text.')
      }
      return {
        definition: findDefinition('text.create')!,
        syntaxStyle: 'canonical',
        canonicalInput: `text.create row=${row} col=${col} text=${quoteCommandValue(text)}`,
        command: {
          kind: 'agent',
          action: { type: 'create_text', row, col, lines: text.split('\n') },
        },
      }
    }

    match = value.match(/^text\.create\s+(-?\d+)\s+(-?\d+)\s+(.+)$/i)
    if (match) {
      const row = Number(match[1])
      const col = Number(match[2])
      const text = parseCommandText(match[3])
      return {
        definition: findDefinition('text.create')!,
        syntaxStyle: 'legacy',
        canonicalInput: `text.create row=${row} col=${col} text=${quoteCommandValue(text)}`,
        command: {
          kind: 'agent',
          action: { type: 'create_text', row, col, lines: text.split('\n') },
        },
      }
    }
  }

  if (commandName === 'line.create') {
    if ('fromrow' in Object.fromEntries(Object.keys(named).map((key) => [key.toLowerCase(), true])) || 'fromRow' in named || 'toRow' in named) {
      const fromRow = ensureNumber(named.fromRow ?? named.fromrow, 'fromRow')
      const fromCol = ensureNumber(named.fromCol ?? named.fromcol, 'fromCol')
      const toRow = ensureNumber(named.toRow ?? named.torow, 'toRow')
      const toCol = ensureNumber(named.toCol ?? named.tocol, 'toCol')
      return {
        definition: findDefinition('line.create')!,
        syntaxStyle: 'canonical',
        canonicalInput: `line.create fromRow=${fromRow} fromCol=${fromCol} toRow=${toRow} toCol=${toCol}`,
        command: {
          kind: 'agent',
          action: {
            type: 'create_line',
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol },
          },
        },
      }
    }

    match = value.match(/^line\.create\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const fromRow = Number(match[1])
      const fromCol = Number(match[2])
      const toRow = Number(match[3])
      const toCol = Number(match[4])
      return {
        definition: findDefinition('line.create')!,
        syntaxStyle: 'legacy',
        canonicalInput: `line.create fromRow=${fromRow} fromCol=${fromCol} toRow=${toRow} toCol=${toCol}`,
        command: {
          kind: 'agent',
          action: {
            type: 'create_line',
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol },
          },
        },
      }
    }
  }

  if (commandName === 'canvas.read') {
    if ('top' in named || 'left' in named || 'width' in named || 'height' in named) {
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const width = ensurePositiveNumber(named.width, 'width')
      const height = ensurePositiveNumber(named.height, 'height')
      return {
        definition: findDefinition('canvas.read')!,
        syntaxStyle: 'canonical',
        canonicalInput: `canvas.read top=${top} left=${left} width=${width} height=${height}`,
        command: { kind: 'canvas.read', top, left, width, height },
      }
    }
    match = value.match(/^canvas\.read\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*$/i)
    if (match) {
      const top = Number(match[1])
      const left = Number(match[2])
      const width = Number(match[3])
      const height = Number(match[4])
      return {
        definition: findDefinition('canvas.read')!,
        syntaxStyle: 'legacy',
        canonicalInput: `canvas.read top=${top} left=${left} width=${width} height=${height}`,
        command: { kind: 'canvas.read', top, left, width, height },
      }
    }
  }

  if (commandName === 'canvas.resize') {
    if ('rows' in named || 'cols' in named) {
      const rows = ensurePositiveNumber(named.rows, 'rows')
      const cols = ensurePositiveNumber(named.cols, 'cols')
      return {
        definition: findDefinition('canvas.resize')!,
        syntaxStyle: 'canonical',
        canonicalInput: `canvas.resize rows=${rows} cols=${cols}`,
        command: {
          kind: 'agent',
          action: { type: 'set_canvas_size', rows, cols },
        },
      }
    }
    match = value.match(/^canvas\.resize\s+(\d+)\s+(\d+)\s*$/i)
    if (match) {
      const rows = Number(match[1])
      const cols = Number(match[2])
      return {
        definition: findDefinition('canvas.resize')!,
        syntaxStyle: 'legacy',
        canonicalInput: `canvas.resize rows=${rows} cols=${cols}`,
        command: {
          kind: 'agent',
          action: { type: 'set_canvas_size', rows, cols },
        },
      }
    }
  }

  if (commandName === 'canvas.expand') {
    if (rest.length === 0 || 'rows' in named || 'cols' in named) {
      const rows = named.rows != null ? ensureNumber(named.rows, 'rows') : 40
      const cols = named.cols != null ? ensureNumber(named.cols, 'cols') : 125
      return {
        definition: findDefinition('canvas.expand')!,
        syntaxStyle: rest.length === 0 ? 'legacy' : 'canonical',
        canonicalInput: `canvas.expand rows=${rows} cols=${cols}`,
        command: {
          kind: 'agent',
          action: { type: 'expand_canvas', rows, cols },
        },
      }
    }
    match = value.match(/^canvas\.expand\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const rows = Number(match[1])
      const cols = Number(match[2])
      return {
        definition: findDefinition('canvas.expand')!,
        syntaxStyle: 'legacy',
        canonicalInput: `canvas.expand rows=${rows} cols=${cols}`,
        command: {
          kind: 'agent',
          action: { type: 'expand_canvas', rows, cols },
        },
      }
    }
  }

  if (/^canvas\.shrink\s*$/i.test(value)) {
    return {
      definition: findDefinition('canvas.shrink')!,
      syntaxStyle: 'canonical',
      canonicalInput: 'canvas.shrink',
      command: {
        kind: 'agent',
        action: { type: 'shrink_canvas_to_fit' },
      },
    }
  }

  if (commandName === 'canvas.apply') {
    const mode = named.mode === 'replace-region' ? 'replace-region' : 'upsert'
    if ('json' in named) {
      const objects = parseJsonSpecs(named.json)
      const clearTypes =
        typeof named.clearTypes === 'string' && named.clearTypes.trim().length > 0
          ? named.clearTypes.split(',').map((value) => value.trim()).filter(Boolean) as CanvasAgentObjectSpec['type'][]
          : undefined
      return {
        definition: findDefinition('canvas.apply')!,
        syntaxStyle: 'canonical',
        canonicalInput: `canvas.apply mode=${mode}${Number.isFinite(Number(named.top)) ? ` top=${Number(named.top)}` : ''}${Number.isFinite(Number(named.left)) ? ` left=${Number(named.left)}` : ''}${Number.isFinite(Number(named.width)) ? ` width=${Number(named.width)}` : ''}${Number.isFinite(Number(named.height)) ? ` height=${Number(named.height)}` : ''}${clearTypes?.length ? ` clearTypes=${quoteCommandValue(clearTypes.join(','))}` : ''} json=${quoteCommandValue(named.json)}`,
        command: {
          kind: 'canvas.apply',
          mode,
          objects,
          ...(named.top != null ? { top: ensureNumber(named.top, 'top') } : {}),
          ...(named.left != null ? { left: ensureNumber(named.left, 'left') } : {}),
          ...(named.width != null ? { width: ensurePositiveNumber(named.width, 'width') } : {}),
          ...(named.height != null ? { height: ensurePositiveNumber(named.height, 'height') } : {}),
          ...(clearTypes?.length ? { clearTypes } : {}),
        },
      }
    }
  }

  if (commandName === 'objects.move') {
    if ('ids' in named || 'deltarow' in Object.fromEntries(Object.keys(named).map((key) => [key.toLowerCase(), true])) || 'deltaRow' in named) {
      const rawIds = named.ids ?? named.objects ?? ''
      const objectIds = rawIds.split(',').map((value) => value.trim()).filter(Boolean)
      if (objectIds.length === 0) {
        throw new Error('Missing ids.')
      }
      const deltaRow = ensureNumber(named.deltaRow ?? named.deltarow, 'deltaRow')
      const deltaCol = ensureNumber(named.deltaCol ?? named.deltacol, 'deltaCol')
      return {
        definition: findDefinition('objects.move')!,
        syntaxStyle: 'canonical',
        canonicalInput: `objects.move ids=${quoteCommandValue(objectIds.join(','))} deltaRow=${deltaRow} deltaCol=${deltaCol}`,
        command: { kind: 'objects.move', objectIds, deltaRow, deltaCol },
      }
    }
    match = value.match(/^objects\.move\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const objectIds = match[1].split(',').map((value) => value.trim()).filter(Boolean)
      const deltaRow = Number(match[2])
      const deltaCol = Number(match[3])
      return {
        definition: findDefinition('objects.move')!,
        syntaxStyle: 'legacy',
        canonicalInput: `objects.move ids=${quoteCommandValue(objectIds.join(','))} deltaRow=${deltaRow} deltaCol=${deltaCol}`,
        command: { kind: 'objects.move', objectIds, deltaRow, deltaCol },
      }
    }
  }

  if (commandName === 'objects.find') {
    const objectTypes =
      typeof named.types === 'string' && named.types.trim().length > 0
        ? named.types.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined
    return {
      definition: findDefinition('objects.find')!,
      syntaxStyle: 'canonical',
      canonicalInput:
        `objects.find${named.type ? ` type=${named.type}` : ''}${objectTypes?.length ? ` types=${quoteCommandValue(objectTypes.join(','))}` : ''}${named.text ? ` text=${quoteCommandValue(named.text)}` : ''}${named.title ? ` title=${quoteCommandValue(named.title)}` : ''}${named.withinTop != null ? ` withinTop=${ensureNumber(named.withinTop, 'withinTop')}` : ''}${named.withinLeft != null ? ` withinLeft=${ensureNumber(named.withinLeft, 'withinLeft')}` : ''}${named.withinWidth != null ? ` withinWidth=${ensurePositiveNumber(named.withinWidth, 'withinWidth')}` : ''}${named.withinHeight != null ? ` withinHeight=${ensurePositiveNumber(named.withinHeight, 'withinHeight')}` : ''}`,
      command: {
        kind: 'objects.find',
        ...(named.type ? { objectType: named.type } : {}),
        ...(objectTypes?.length ? { objectTypes } : {}),
        ...(named.text ? { textContains: named.text } : {}),
        ...(named.title ? { labelContains: named.title } : {}),
        ...(named.withinTop != null ? { withinTop: ensureNumber(named.withinTop, 'withinTop') } : {}),
        ...(named.withinLeft != null ? { withinLeft: ensureNumber(named.withinLeft, 'withinLeft') } : {}),
        ...(named.withinWidth != null ? { withinWidth: ensurePositiveNumber(named.withinWidth, 'withinWidth') } : {}),
        ...(named.withinHeight != null ? { withinHeight: ensurePositiveNumber(named.withinHeight, 'withinHeight') } : {}),
      },
    }
  }

  if (commandName === 'objects.replace') {
    const rawIds = named.ids ?? named.objects ?? ''
    const objectIds = rawIds.split(',').map((value) => value.trim()).filter(Boolean)
    if (objectIds.length === 0) {
      throw new Error('Missing ids.')
    }
    if (typeof named.json !== 'string') {
      throw new Error('Missing json.')
    }
    return {
      definition: findDefinition('objects.replace')!,
      syntaxStyle: 'canonical',
      canonicalInput: `objects.replace ids=${quoteCommandValue(objectIds.join(','))} json=${quoteCommandValue(named.json)}`,
      command: {
        kind: 'agent',
        action: {
          type: 'replace_objects',
          objectIds,
          objects: parseJsonSpecs(named.json),
        },
      },
    }
  }

  if (commandName === 'stack.pack') {
    const rawIds = named.ids ?? named.objects ?? ''
    const objectIds = rawIds.split(',').map((value) => value.trim()).filter(Boolean)
    if (objectIds.length === 0) {
      throw new Error('Missing ids.')
    }
    const axis = String(named.axis ?? 'vertical').toLowerCase()
    if (!['vertical', 'horizontal'].includes(axis)) {
      throw new Error('axis must be vertical or horizontal.')
    }
    const align = String(named.align ?? 'start').toLowerCase()
    if (!['start', 'center', 'end'].includes(align)) {
      throw new Error('align must be start, center, or end.')
    }
    const gapValue = named.gap ?? '0'
    const gap =
      typeof gapValue === 'string' && gapValue.trim().toLowerCase() === 'shared'
        ? -1
        : ensureNumber(gapValue, 'gap')
    return {
      definition: findDefinition('stack.pack')!,
      syntaxStyle: 'canonical',
      canonicalInput: `stack.pack ids=${quoteCommandValue(objectIds.join(','))} axis=${axis} gap=${gap === -1 ? 'shared' : gap} align=${align}`,
      command: {
        kind: 'agent',
        action: {
          type: 'pack_objects',
          objectIds,
          axis: axis as 'vertical' | 'horizontal',
          gap,
          align: align as 'start' | 'center' | 'end',
        },
      },
    }
  }

  if (commandName === 'objects.align') {
    const rawIds = named.ids ?? named.objects ?? ''
    const objectIds = rawIds.split(',').map((value) => value.trim()).filter(Boolean)
    if (objectIds.length === 0) {
      throw new Error('Missing ids.')
    }
    const edge = String(named.edge ?? '').toLowerCase()
    if (!['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'].includes(edge)) {
      throw new Error('edge must be left, right, top, bottom, hcenter, or vcenter.')
    }
    return {
      definition: findDefinition('objects.align')!,
      syntaxStyle: 'canonical',
      canonicalInput: `objects.align ids=${quoteCommandValue(objectIds.join(','))} edge=${edge}`,
      command: {
        kind: 'agent',
        action: {
          type: 'align_objects',
          objectIds,
          edge: edge as 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter',
        },
      },
    }
  }

  if (commandName === 'object.update') {
    const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
    const hasPatchField = ['top', 'left', 'width', 'height', 'row', 'col', 'title', 'text', 'body', 'align']
      .some((key) => key in named)
    if (!hasPatchField) {
      throw new Error('Provide at least one patch field.')
    }
    const align = named.align ? String(named.align).toUpperCase() : null
    if (align && !['LEFT', 'CENTER', 'RIGHT'].includes(align)) {
      throw new Error('align must be left, center, or right.')
    }
    const parts = [`object.update target=${target === selectedObjectId ? 'selected' : target}`]
    if (named.top != null) parts.push(`top=${ensureNumber(named.top, 'top')}`)
    if (named.left != null) parts.push(`left=${ensureNumber(named.left, 'left')}`)
    if (named.width != null) parts.push(`width=${ensurePositiveNumber(named.width, 'width')}`)
    if (named.height != null) parts.push(`height=${ensurePositiveNumber(named.height, 'height')}`)
    if (named.row != null) parts.push(`row=${ensureNumber(named.row, 'row')}`)
    if (named.col != null) parts.push(`col=${ensureNumber(named.col, 'col')}`)
    if (named.title != null) parts.push(`title=${quoteCommandValue(named.title)}`)
    if (named.body != null) parts.push(`body=${quoteCommandValue(named.body)}`)
    if (named.text != null) parts.push(`text=${quoteCommandValue(named.text)}`)
    if (align) parts.push(`align=${align.toLowerCase()}`)
    return {
      definition: findDefinition('object.update')!,
      syntaxStyle: 'canonical',
      canonicalInput: parts.join(' '),
      command: {
        kind: 'agent',
        action: {
          type: 'patch_object',
          objectId: target,
          ...(named.top != null ? { top: ensureNumber(named.top, 'top') } : {}),
          ...(named.left != null ? { left: ensureNumber(named.left, 'left') } : {}),
          ...(named.width != null ? { width: ensurePositiveNumber(named.width, 'width') } : {}),
          ...(named.height != null ? { height: ensurePositiveNumber(named.height, 'height') } : {}),
          ...(named.row != null ? { row: ensureNumber(named.row, 'row') } : {}),
          ...(named.col != null ? { col: ensureNumber(named.col, 'col') } : {}),
          ...(named.title != null ? { title: named.title } : {}),
          ...(named.body != null ? { body: named.body } : {}),
          ...(named.text != null ? { text: named.text } : {}),
          ...(align ? { alignment: align as 'LEFT' | 'CENTER' | 'RIGHT' } : {}),
        },
      },
    }
  }

  if (commandName === 'object.move') {
    if ('target' in named || 'top' in named || 'left' in named) {
      const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      return {
        definition: findDefinition('object.move')!,
        syntaxStyle: 'canonical',
        canonicalInput: `object.move target=${target === selectedObjectId ? 'selected' : target} top=${top} left=${left}`,
        command: { kind: 'agent', action: { type: 'move_object', objectId: target, top, left } },
      }
    }

    match = value.match(/^object\.move\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      const top = Number(match[2])
      const left = Number(match[3])
      return {
        definition: findDefinition('object.move')!,
        syntaxStyle: 'legacy',
        canonicalInput: `object.move target=${target === selectedObjectId ? 'selected' : target} top=${top} left=${left}`,
        command: { kind: 'agent', action: { type: 'move_object', objectId: target, top, left } },
      }
    }
  }

  if (commandName === 'object.resize') {
    if ('target' in named || 'top' in named || 'left' in named || 'width' in named || 'height' in named) {
      const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const width = ensurePositiveNumber(named.width, 'width')
      const height = ensurePositiveNumber(named.height, 'height')
      return {
        definition: findDefinition('object.resize')!,
        syntaxStyle: 'canonical',
        canonicalInput: `object.resize target=${target === selectedObjectId ? 'selected' : target} top=${top} left=${left} width=${width} height=${height}`,
        command: { kind: 'agent', action: { type: 'resize_object', objectId: target, top, left, width, height } },
      }
    }

    match = value.match(/^object\.resize\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      const top = Number(match[2])
      const left = Number(match[3])
      const width = Number(match[4])
      const height = Number(match[5])
      return {
        definition: findDefinition('object.resize')!,
        syntaxStyle: 'legacy',
        canonicalInput: `object.resize target=${target === selectedObjectId ? 'selected' : target} top=${top} left=${left} width=${width} height=${height}`,
        command: { kind: 'agent', action: { type: 'resize_object', objectId: target, top, left, width, height } },
      }
    }
  }

  if (commandName === 'object.delete') {
    if ('target' in named) {
      const target = resolveCommandTarget(named.target, selectedObjectId)
      return {
        definition: findDefinition('object.delete')!,
        syntaxStyle: 'canonical',
        canonicalInput: `object.delete target=${target === selectedObjectId ? 'selected' : target}`,
        command: { kind: 'agent', action: { type: 'delete_object', objectId: target } },
      }
    }
    match = value.match(/^object\.delete\s+(\S+)\s*$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      return {
        definition: findDefinition('object.delete')!,
        syntaxStyle: 'legacy',
        canonicalInput: `object.delete target=${target === selectedObjectId ? 'selected' : target}`,
        command: { kind: 'agent', action: { type: 'delete_object', objectId: target } },
      }
    }
  }

  if (commandName === 'text.align') {
    if ('target' in named || 'align' in named) {
      const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
      const alignment = (named.align ?? '').toUpperCase()
      if (!['LEFT', 'CENTER', 'RIGHT'].includes(alignment)) {
        throw new Error('align must be left, center, or right.')
      }
      return {
        definition: findDefinition('text.align')!,
        syntaxStyle: 'canonical',
        canonicalInput: `text.align target=${target === selectedObjectId ? 'selected' : target} align=${alignment.toLowerCase()}`,
        command: { kind: 'agent', action: { type: 'set_text_alignment', objectId: target, alignment: alignment as 'LEFT' | 'CENTER' | 'RIGHT' } },
      }
    }
    match = value.match(/^text\.align\s+(\S+)\s+(left|center|right)\s*$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      const alignment = match[2].toUpperCase() as 'LEFT' | 'CENTER' | 'RIGHT'
      return {
        definition: findDefinition('text.align')!,
        syntaxStyle: 'legacy',
        canonicalInput: `text.align target=${target === selectedObjectId ? 'selected' : target} align=${alignment.toLowerCase()}`,
        command: { kind: 'agent', action: { type: 'set_text_alignment', objectId: target, alignment } },
      }
    }
  }

  if (commandName === 'text.enclose') {
    if ('target' in named || 'padding' in named) {
      const target = resolveCommandTarget(named.target ?? 'selected', selectedObjectId)
      const padding = named.padding ? ensurePositiveNumber(named.padding, 'padding') : undefined
      return {
        definition: findDefinition('text.enclose')!,
        syntaxStyle: 'canonical',
        canonicalInput: `text.enclose target=${target === selectedObjectId ? 'selected' : target}${padding != null ? ` padding=${padding}` : ''}`,
        command: { kind: 'agent', action: { type: 'enclose_text', objectId: target, ...(padding != null ? { padding } : {}) } },
      }
    }
    match = value.match(/^text\.enclose\s+(\S+)(?:\s+(\d+))?\s*$/i)
    if (match) {
      const target = resolveCommandTarget(match[1], selectedObjectId)
      const padding = match[2] ? Number(match[2]) : undefined
      return {
        definition: findDefinition('text.enclose')!,
        syntaxStyle: 'legacy',
        canonicalInput: `text.enclose target=${target === selectedObjectId ? 'selected' : target}${padding != null ? ` padding=${padding}` : ''}`,
        command: { kind: 'agent', action: { type: 'enclose_text', objectId: target, ...(padding != null ? { padding } : {}) } },
      }
    }
  }

  if (/^(?:page\.new|diagram\.new)$/i.test(commandName)) {
    if ('name' in named) {
      return {
        definition: findDefinition('page.new')!,
        syntaxStyle: 'canonical',
        canonicalInput: `page.new${named.name ? ` name=${quoteCommandValue(named.name)}` : ''}`,
        command: { kind: 'page.new', name: named.name?.trim() || null },
      }
    }
    match = value.match(/^(?:page\.new|diagram\.new)(?:\s+(.+))?\s*$/i)
    if (match) {
      const name = match[1]?.trim() || null
      return {
        definition: findDefinition('page.new')!,
        syntaxStyle: 'legacy',
        canonicalInput: `page.new${name ? ` name=${quoteCommandValue(name)}` : ''}`,
        command: { kind: 'page.new', name },
      }
    }
  }

  if (/^(?:page\.open|diagram\.switch)$/i.test(commandName)) {
    if ('target' in named) {
      return {
        definition: findDefinition('page.open')!,
        syntaxStyle: 'canonical',
        canonicalInput: `page.open target=${quoteCommandValue(named.target)}`,
        command: { kind: 'page.open', query: named.target },
      }
    }
    match = value.match(/^(?:page\.open|diagram\.switch)\s+(.+)\s*$/i)
    if (match) {
      const query = match[1].trim()
      return {
        definition: findDefinition('page.open')!,
        syntaxStyle: 'legacy',
        canonicalInput: `page.open target=${quoteCommandValue(query)}`,
        command: { kind: 'page.open', query },
      }
    }
  }

  if (/^(?:page\.list|diagram\.list)\s*$/i.test(value)) {
    return {
      definition: findDefinition('page.list')!,
      syntaxStyle: commandName === 'diagram.list' ? 'legacy' : 'canonical',
      canonicalInput: 'page.list',
      command: { kind: 'page.list' },
    }
  }

  if (/^group\.create(?:\s+selected)?\s*$/i.test(value)) {
    return {
      definition: findDefinition('group.create')!,
      syntaxStyle: value.includes('selected') ? 'legacy' : 'canonical',
      canonicalInput: 'group.create',
      command: { kind: 'group.create' },
    }
  }

  if (/^group\.break(?:\s+selected)?\s*$/i.test(value)) {
    return {
      definition: findDefinition('group.break')!,
      syntaxStyle: value.includes('selected') ? 'legacy' : 'canonical',
      canonicalInput: 'group.break',
      command: { kind: 'group.break' },
    }
  }

  if (/^component\.mark\s*$/i.test(value)) {
    return {
      definition: findDefinition('component.mark')!,
      syntaxStyle: 'canonical',
      canonicalInput: 'component.mark',
      command: { kind: 'component.mark' },
    }
  }

  if (commandName === 'component.create') {
    if ('name' in named) {
      const name = named.name?.trim() || null
      return {
        definition: findDefinition('component.create')!,
        syntaxStyle: 'canonical',
        canonicalInput: `component.create${name ? ` name=${quoteCommandValue(name)}` : ''}`,
        command: { kind: 'component.create', name },
      }
    }
    match = value.match(/^component\.create(?:\s+(.+))?\s*$/i)
    if (match) {
      const name = match[1]?.trim() || null
      return {
        definition: findDefinition('component.create')!,
        syntaxStyle: 'legacy',
        canonicalInput: `component.create${name ? ` name=${quoteCommandValue(name)}` : ''}`,
        command: { kind: 'component.create', name },
      }
    }
  }

  if (commandName === 'component.attr') {
    match = value.match(/^component\.attr\s+add\s+([\w.-]+)(?:\s+default="([^"]*)")?\s*$/i)
    if (match) {
      const key = match[1]
      const defaultValue = parseCommandText(match[2] ?? '')
      return {
        definition: findDefinition('component.attr')!,
        syntaxStyle: 'legacy',
        canonicalInput: `component.attr add key=${key}${defaultValue ? ` default=${quoteCommandValue(defaultValue)}` : ''}`,
        command: { kind: 'component.attr.upsert', key, defaultValue },
      }
    }
    match = value.match(/^component\.attr\s+remove\s+([\w.-]+)\s*$/i)
    if (match) {
      const key = match[1]
      return {
        definition: findDefinition('component.attr')!,
        syntaxStyle: 'legacy',
        canonicalInput: `component.attr remove key=${key}`,
        command: { kind: 'component.attr.remove', key },
      }
    }
    match = value.match(/^component\.attr\s+(add|remove)\s+(.*)$/i)
    if (match) {
      const verb = match[1].toLowerCase()
      const args = parseNamedStringArgs(match[2] ?? '')
      const key = args.key ?? match[2].trim()
      if (!key) {
        throw new Error('Missing component attribute key.')
      }
      if (verb === 'add') {
        const defaultValue = args.default ?? ''
        return {
          definition: findDefinition('component.attr')!,
          syntaxStyle: 'canonical',
          canonicalInput: `component.attr add key=${key}${defaultValue ? ` default=${quoteCommandValue(defaultValue)}` : ''}`,
          command: { kind: 'component.attr.upsert', key, defaultValue },
        }
      }
      return {
        definition: findDefinition('component.attr')!,
        syntaxStyle: 'canonical',
        canonicalInput: `component.attr remove key=${key}`,
        command: { kind: 'component.attr.remove', key },
      }
    }
  }

  if (commandName === 'component.use') {
    if ('source' in named || ('top' in named && 'left' in named)) {
      const source = named.source
      if (!source) {
        throw new Error('Missing source.')
      }
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const { source: _source, top: _top, left: _left, ...props } = named
      const propSuffix = Object.entries(props)
        .map(([key, value]) => ` ${key}=${quoteCommandValue(value)}`)
        .join('')
      return {
        definition: findDefinition('component.use')!,
        syntaxStyle: 'canonical',
        canonicalInput: `component.use source=${quoteCommandValue(source)} top=${top} left=${left}${propSuffix}`,
        command: { kind: 'component.use', query: source, top, left, props },
      }
    }
    match = value.match(/^component\.use\s+(.+?)\s+(-?\d+)\s+(-?\d+)(.*)$/i)
    if (match) {
      const query = match[1].trim()
      const top = Number(match[2])
      const left = Number(match[3])
      const props = parseNamedStringArgs(match[4] ?? '')
      const propSuffix = Object.entries(props)
        .map(([key, value]) => ` ${key}=${quoteCommandValue(value)}`)
        .join('')
      return {
        definition: findDefinition('component.use')!,
        syntaxStyle: 'legacy',
        canonicalInput: `component.use source=${quoteCommandValue(query)} top=${top} left=${left}${propSuffix}`,
        command: { kind: 'component.use', query, top, left, props },
      }
    }
  }

  const exactCommand = findDefinition(commandName)
  if (exactCommand) {
    throw new Error(`Usage: ${exactCommand.canonicalUsage}`)
  }

  throw new Error(`Unknown command. Try: ${TERMINAL_COMMANDS.map((command) => command.name).join(', ')}.`)
}

/**
 * Partial previews intentionally accept incomplete coordinates so the terminal feels
 * spatial while the user is still typing.
 */
export function buildTerminalPreview(
  input: string,
  state: AppState | null,
  selectedObjectId: string | null,
): EditorTerminalPreview | null {
  const value = input.trim()
  if (!value || !state) return null

  const activePage = getActivePage(state)
  const commandName = value.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const numbers = getLeadingNumbers(value)
  const named = parseNamedStringArgs(value.slice(commandName.length).trim())

  if (['objects.find', 'objects.replace', 'stack.pack', 'objects.align', 'object.update'].includes(commandName)) {
    const preview = buildLiveCanvasCommandPreview(value, { canvasId: activePage.id })
    if (preview) {
      return preview as EditorTerminalPreview
    }
  }

  if (commandName === 'box.create') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const width = named.width != null ? Number(named.width) : numbers[2]
    const height = named.height != null ? Number(named.height) : numbers[3]
    if (Number.isFinite(top) && Number.isFinite(left) && Number.isFinite(width) && Number.isFinite(height)) {
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top,
        left,
        width: Math.max(1, width),
        height: Math.max(1, height),
        label: `Box at (${top}, ${left}) · ${Math.max(1, width)}×${Math.max(1, height)}`,
      }
    }
    if (Number.isFinite(top)) {
      return {
        kind: 'point',
        canvasId: activePage.id,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Box anchor at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', label: 'Type top and left to preview the box anchor.' }
  }

  if (commandName === 'canvas.read') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const width = named.width != null ? Number(named.width) : numbers[2]
    const height = named.height != null ? Number(named.height) : numbers[3]
    if ([top, left, width, height].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top,
        left,
        width: Math.max(1, width),
        height: Math.max(1, height),
        label: `Read region ${Math.max(1, width)}×${Math.max(1, height)} at (${top}, ${left})`,
      }
    }
    if (Number.isFinite(top)) {
      return {
        kind: 'point',
        canvasId: activePage.id,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Region start at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
  }

  if (commandName === 'canvas.resize') {
    const rows = named.rows != null ? Number(named.rows) : numbers[0]
    const cols = named.cols != null ? Number(named.cols) : numbers[1]
    if ([rows, cols].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top: 0,
        left: 0,
        width: Math.max(1, cols),
        height: Math.max(1, rows),
        label: `Resize canvas to ${Math.max(1, rows)} rows × ${Math.max(1, cols)} cols`,
      }
    }
    return { kind: 'info', label: 'Type rows and cols to preview the resized canvas bounds.' }
  }

  if (commandName === 'canvas.expand') {
    const rowDelta = named.rows != null ? Number(named.rows) : Number.isFinite(numbers[0]) ? numbers[0] : 40
    const colDelta = named.cols != null ? Number(named.cols) : Number.isFinite(numbers[1]) ? numbers[1] : 125
    if ([rowDelta, colDelta].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top: 0,
        left: 0,
        width: Math.max(1, activePage.data.canvasSize.cols + Math.max(0, colDelta)),
        height: Math.max(1, activePage.data.canvasSize.rows + Math.max(0, rowDelta)),
        label: `Expand canvas by ${Math.max(0, rowDelta)} rows and ${Math.max(0, colDelta)} cols`,
      }
    }
    return { kind: 'info', label: 'Type row/col deltas to preview the expanded canvas.' }
  }

  if (commandName === 'canvas.shrink') {
    const nextSize = getDiagramShrinkToFitCanvasSize(activePage)
    return {
      kind: 'rect',
      canvasId: activePage.id,
      top: 0,
      left: 0,
      width: nextSize.cols,
      height: nextSize.rows,
      label: `Shrink canvas to ${nextSize.rows} rows × ${nextSize.cols} cols`,
    }
  }

  if (commandName === 'canvas.apply') {
    if (typeof named.json === 'string') {
      try {
        const objects = parseJsonSpecs(named.json)
        const rects = objects.flatMap((spec) =>
          spec.type === 'rectangle'
            ? [{ top: spec.top, left: spec.left, width: spec.width, height: spec.height }]
            : spec.type === 'text'
              ? [{ top: spec.row, left: spec.col, width: Math.max(1, ...(spec.lines ?? String(spec.text ?? '').split('\n')).map((line) => line.length)), height: (spec.lines ?? String(spec.text ?? '').split('\n')).length }]
              : spec.type === 'line'
                ? [{ top: Math.min(spec.from.row, spec.to.row), left: Math.min(spec.from.col, spec.to.col), width: Math.abs(spec.to.col - spec.from.col) + 1, height: Math.abs(spec.to.row - spec.from.row) + 1 }]
                : spec.points.length > 0
                  ? [{
                      top: Math.min(...spec.points.map((point) => point.row)),
                      left: Math.min(...spec.points.map((point) => point.col)),
                      width: Math.max(...spec.points.map((point) => point.col)) - Math.min(...spec.points.map((point) => point.col)) + 1,
                      height: Math.max(...spec.points.map((point) => point.row)) - Math.min(...spec.points.map((point) => point.row)) + 1,
                    }]
                  : [],
        )
        if (rects.length > 0) {
          const top = Math.min(...rects.map((rect) => rect.top))
          const left = Math.min(...rects.map((rect) => rect.left))
          const right = Math.max(...rects.map((rect) => rect.left + rect.width - 1))
          const bottom = Math.max(...rects.map((rect) => rect.top + rect.height - 1))
          return {
            kind: 'rect',
            canvasId: activePage.id,
            top,
            left,
            width: right - left + 1,
            height: bottom - top + 1,
            label: `Apply ${objects.length} objects`,
          }
        }
      } catch {
        return { kind: 'info', label: 'Type a valid JSON array to preview the bulk apply.' }
      }
    }
  }

  if (commandName === 'objects.find') {
    const topValue = named.withinTop != null ? Number(named.withinTop) : null
    const leftValue = named.withinLeft != null ? Number(named.withinLeft) : null
    const widthValue = named.withinWidth != null ? Number(named.withinWidth) : null
    const heightValue = named.withinHeight != null ? Number(named.withinHeight) : null
    if ([topValue, leftValue, widthValue, heightValue].every(Number.isFinite)) {
      const top = topValue as number
      const left = leftValue as number
      const width = widthValue as number
      const height = heightValue as number
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top,
        left,
        width,
        height,
        label: 'Find objects in region',
      }
    }
    return { kind: 'info', label: 'Find objects by type/text/title and optional region.' }
  }

  if (commandName === 'objects.replace') {
    if (typeof named.json === 'string') {
      try {
        const objects = parseJsonSpecs(named.json)
        if (objects.length > 0) {
          const bounds = objects.map(getSpecBounds)
          const top = Math.min(...bounds.map((entry) => entry.top))
          const left = Math.min(...bounds.map((entry) => entry.left))
          const right = Math.max(...bounds.map((entry) => entry.right))
          const bottom = Math.max(...bounds.map((entry) => entry.bottom))
          return {
            kind: 'rect',
            canvasId: activePage.id,
            top,
            left,
            width: right - left + 1,
            height: bottom - top + 1,
            label: `Replace with ${objects.length} objects`,
          }
        }
      } catch {
        return { kind: 'info', label: 'Type a valid JSON array to preview replacement.' }
      }
    }
    return { kind: 'info', label: 'Delete exact ids and draw the replacement objects.' }
  }

  if (commandName === 'stack.pack') {
    return { kind: 'info', label: 'Pack the listed objects into a stack.' }
  }

  if (commandName === 'objects.align') {
    return { kind: 'info', label: 'Align the listed objects to one edge.' }
  }

  if (commandName === 'object.update') {
    const topValue = named.top != null ? Number(named.top) : named.row != null ? Number(named.row) : null
    const leftValue = named.left != null ? Number(named.left) : named.col != null ? Number(named.col) : null
    const widthValue = named.width != null ? Number(named.width) : null
    const heightValue = named.height != null ? Number(named.height) : null
    if ([topValue, leftValue, widthValue, heightValue].every(Number.isFinite)) {
      const top = topValue as number
      const left = leftValue as number
      const width = widthValue as number
      const height = heightValue as number
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top,
        left,
        width,
        height,
        label: 'Patch target bounds',
      }
    }
    if ([topValue, leftValue].every(Number.isFinite)) {
      const top = topValue as number
      const left = leftValue as number
      return {
        kind: 'point',
        canvasId: activePage.id,
        row: top,
        col: left,
        label: 'Patch target anchor',
      }
    }
    return { kind: 'info', label: 'Patch one object in place.' }
  }

  if (commandName === 'text.create') {
    const row = named.row != null ? Number(named.row) : numbers[0]
    const col = named.col != null ? Number(named.col) : numbers[1]
    if (Number.isFinite(row)) {
      return {
        kind: 'point',
        canvasId: activePage.id,
        row,
        col: Number.isFinite(col) ? col : 0,
        label: `Text cursor at (${row}, ${Number.isFinite(col) ? col : 0})`,
      }
    }
    return { kind: 'info', label: 'Type row and col to preview text placement.' }
  }

  if (commandName === 'line.create') {
    const fromRow = named.fromRow != null ? Number(named.fromRow) : numbers[0]
    const fromCol = named.fromCol != null ? Number(named.fromCol) : numbers[1]
    const toRow = named.toRow != null ? Number(named.toRow) : numbers[2]
    const toCol = named.toCol != null ? Number(named.toCol) : numbers[3]
    if ([fromRow, fromCol, toRow, toCol].every(Number.isFinite)) {
      return {
        kind: 'line',
        canvasId: activePage.id,
        from: { row: fromRow, col: fromCol },
        to: { row: toRow, col: toCol },
        label: `Line from (${fromRow}, ${fromCol}) to (${toRow}, ${toCol})`,
      }
    }
    if (Number.isFinite(fromRow)) {
      return {
        kind: 'point',
        canvasId: activePage.id,
        row: fromRow,
        col: Number.isFinite(fromCol) ? fromCol : 0,
        label: `Line start at (${fromRow}, ${Number.isFinite(fromCol) ? fromCol : 0})`,
      }
    }
    return { kind: 'info', label: 'Type line coordinates to preview the connector.' }
  }

  if (commandName === 'object.move') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    if (Number.isFinite(top)) {
      return {
        kind: 'point',
        canvasId: activePage.id,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Move target at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return selectedObjectId
      ? { kind: 'info', label: `Moving selected object ${selectedObjectId.slice(0, 8)}… type top/left.` }
      : { kind: 'info', label: 'Select an object, then type top/left.' }
  }

  if (commandName === 'object.resize') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const width = named.width != null ? Number(named.width) : numbers[2]
    const height = named.height != null ? Number(named.height) : numbers[3]
    if ([top, left, width, height].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId: activePage.id,
        top,
        left,
        width: Math.max(1, width),
        height: Math.max(1, height),
        label: `Resize target to ${Math.max(1, width)}×${Math.max(1, height)}`,
      }
    }
    if (Number.isFinite(top)) {
      return {
        kind: 'point',
        canvasId: activePage.id,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Resize anchor at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', label: 'Type top/left/width/height to preview resize.' }
  }

  if (isStructureCanvasCommandName(commandName)) {
    return buildStructureCanvasCommandPreview(value, state) as EditorTerminalPreview | null
  }

  return null
}

export function executeTerminalCommand(
  state: AppState,
  command: TerminalCommand,
  selectedObjectIds: string[] = [],
): TerminalExecutionResult {
  if (command.kind === 'canvas.status') {
    const activePage = getActivePage(state)
    return {
      nextState: state,
      message: `Canvas ${activePage.id} is active.`,
      output: JSON.stringify(
        {
          liveReady: false,
          activeCanvasId: activePage.id,
          revision: null,
          collaboratorCount: 0,
          note: 'Local terminal preview only. Use the live command runner or MCP for room status.',
        },
        null,
        2,
      ),
    }
  }

  if (command.kind === 'canvas.read') {
    const snapshot = buildLocalCanvasRegionSnapshot(state, state.activeDiagramId, {
      top: command.top,
      left: command.left,
      width: command.width,
      height: command.height,
    })
    return {
      nextState: state,
      message: `Read ${snapshot.objectCount} object${snapshot.objectCount === 1 ? '' : 's'} from the region.`,
      output: JSON.stringify(snapshot, null, 2),
    }
  }

  if (command.kind === 'canvas.apply') {
    const action: CanvasAgentAction =
      command.mode === 'replace-region'
        ? {
            type: 'replace_region',
            canvasId: state.activeDiagramId,
            top: ensureIntegerFromInput(command.top, 'top'),
            left: ensureIntegerFromInput(command.left, 'left'),
            width: ensureIntegerFromInput(command.width, 'width'),
            height: ensureIntegerFromInput(command.height, 'height'),
            clearTypes: command.clearTypes,
            objects: command.objects,
          }
        : {
            type: 'upsert_objects',
            canvasId: state.activeDiagramId,
            objects: command.objects,
          }
    const nextState = applyAgentActionToEditorState(state, action)
    return {
      nextState,
      message:
        command.mode === 'replace-region'
          ? `Replaced region with ${command.objects.length} object${command.objects.length === 1 ? '' : 's'}.`
          : `Applied ${command.objects.length} object upsert${command.objects.length === 1 ? '' : 's'}.`,
      output: JSON.stringify(
        {
          mode: command.mode,
          objectCount: command.objects.length,
          objects: command.objects,
        },
        null,
        2,
      ),
    }
  }

  if (command.kind === 'objects.move') {
    const nextState = applyAgentActionToEditorState(state, {
      type: 'move_objects',
      canvasId: state.activeDiagramId,
      objectIds: command.objectIds,
      deltaRow: command.deltaRow,
      deltaCol: command.deltaCol,
    })
    return {
      nextState,
      message: `Moved ${command.objectIds.length} object${command.objectIds.length === 1 ? '' : 's'}.`,
      output: JSON.stringify(
        {
          objectIds: command.objectIds,
          deltaRow: command.deltaRow,
          deltaCol: command.deltaCol,
        },
        null,
        2,
      ),
    }
  }

  if (command.kind === 'objects.find') {
    const diagram = getActivePage(state)
    const specs = diagram.data.shapes.map(serializeShapeObjectAsAgentSpec)
    const matches = specs.filter((spec) => {
      const typeMatches =
        (!command.objectType && !command.objectTypes?.length) ||
        (command.objectType != null && spec.type === command.objectType) ||
        (command.objectTypes?.length ? command.objectTypes.includes(spec.type) : false)
      if (!typeMatches) return false
      const bounds = getSpecBounds(spec)
      if (
        command.withinTop != null &&
        command.withinLeft != null &&
        command.withinWidth != null &&
        command.withinHeight != null
      ) {
        const withinRight = command.withinLeft + command.withinWidth - 1
        const withinBottom = command.withinTop + command.withinHeight - 1
        if (
          bounds.left < command.withinLeft ||
          bounds.top < command.withinTop ||
          bounds.right > withinRight ||
          bounds.bottom > withinBottom
        ) {
          return false
        }
      }
      const textLines =
        spec.type === 'rectangle'
          ? [spec.label ?? '', ...(spec.bodyLines ?? [])].filter(Boolean)
          : spec.type === 'text'
            ? spec.lines ?? (typeof spec.text === 'string' ? spec.text.split('\n') : [])
            : spec.labelLines ?? []
      const haystack = textLines.join('\n').toLowerCase()
      if (command.textContains && !haystack.includes(command.textContains.toLowerCase())) return false
      if (command.labelContains && !haystack.includes(command.labelContains.toLowerCase())) return false
      return true
    })
    return {
      nextState: state,
      message: `Found ${matches.length} object${matches.length === 1 ? '' : 's'}.`,
      output: JSON.stringify(matches, null, 2),
    }
  }

  if (command.kind === 'agent') {
    const action =
      'canvasId' in command.action
        ? {
            ...command.action,
            canvasId: command.action.canvasId ?? state.activeDiagramId,
          }
        : command.action
    const nextState = applyAgentActionToEditorState(state, action)
    return {
      nextState,
      message: `Applied ${command.action.type}.`,
    }
  }
  return executeStructureCanvasCommand(state, command, {
    selectedObjectIds,
  }) as TerminalExecutionResult
}
