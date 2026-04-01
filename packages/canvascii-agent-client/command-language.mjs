/**
 * Shared live command grammar for humans and agents.
 *
 * The goal is simple:
 * - humans can type terse commands
 * - agents can use the exact same verbs through MCP
 * - every accepted command normalizes to one explicit keyed form
 *
 * This module intentionally focuses on live canvas commands that can run
 * directly against the websocket room: reads, bulk apply, object edits, and
 * root-canvas sizing. Canvas-structure commands use a sibling runtime with
 * the same canonical grammar, but a different transport contract.
 */

const DEFAULT_CANVAS_ROWS = 75
const DEFAULT_CANVAS_COLS = 250
const DEFAULT_EXPAND_ROWS = 40
const DEFAULT_EXPAND_COLS = 125

export const LIVE_CANVAS_COMMANDS = [
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
    name: 'canvas.apply',
    canonicalUsage:
      `canvas.apply mode=upsert json='[{\"type\":\"rectangle\",\"top\":5,\"left\":10,\"width\":20,\"height\":8,\"label\":\"Header\"}]'`,
    aliases: [`canvas.apply json='[{\"type\":\"text\",\"row\":5,\"col\":10,\"text\":\"Hello\"}]'`],
    description: 'Apply a whole JSON drawing payload in one live submission.',
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
]

function parseCommandText(value) {
  return value.replace(/\\n/g, '\n')
}

function parseJsonSpecs(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Missing json.')
  }

  let value = null
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('json must be a valid JSON array of object specs.')
  }

  if (!Array.isArray(value)) {
    throw new Error('json must be a JSON array of object specs.')
  }

  if (!value.every((entry) => entry && typeof entry === 'object' && typeof entry.type === 'string')) {
    throw new Error('Each object spec must be an object with a type.')
  }

  return value
}

function quoteCommandValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
}

function parseNamedStringArgs(input) {
  const props = {}
  const pattern = /([\w.-]+)=("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+)/g
  let match = null
  while ((match = pattern.exec(input))) {
    const key = match[1]
    const raw = match[2]
    if (!key || !raw) continue
    const unquoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    props[key] = parseCommandText(
      unquoted.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\'),
    )
  }
  return props
}

function getLeadingNumbers(input) {
  const matches = input.match(/-?\d+/g) ?? []
  return matches.map((value) => Number(value))
}

function ensureNumber(value, label) {
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${label}.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`)
  }
  return parsed
}

function ensurePositiveNumber(value, label) {
  const parsed = ensureNumber(value, label)
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than 0.`)
  }
  return parsed
}

function findDefinition(name) {
  return LIVE_CANVAS_COMMANDS.find((command) => command.name === name) ?? null
}

function targetTokenSuffix(targetToken) {
  return targetToken === 'selected' ? 'selected' : targetToken
}

function getObjectAnchor(object) {
  switch (object?.geometry?.type) {
    case 'rectangle':
      return {
        row: object.geometry.topLeft.row,
        col: object.geometry.topLeft.col,
      }
    case 'text':
      return {
        row: object.geometry.start.row,
        col: object.geometry.start.col,
      }
    case 'line':
      return {
        row: object.geometry.segment.start.row,
        col: object.geometry.segment.start.col,
      }
    case 'polyline':
      return object.geometry.segments[0]?.start
        ? {
            row: object.geometry.segments[0].start.row,
            col: object.geometry.segments[0].start.col,
          }
        : null
    default:
      return null
  }
}

function getObjectBounds(object) {
  switch (object?.geometry?.type) {
    case 'rectangle': {
      const top = Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const left = Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      const bottom = Math.max(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const right = Math.max(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
      }
    }
    case 'text': {
      const lines = object.geometry.lines ?? []
      const width = lines.reduce((max, line) => Math.max(max, Array.from(line).length), 0)
      return {
        top: object.geometry.start.row,
        left: object.geometry.start.col,
        width: Math.max(1, width),
        height: Math.max(1, lines.length || 1),
      }
    }
    case 'line': {
      const top = Math.min(object.geometry.segment.start.row, object.geometry.segment.end.row)
      const left = Math.min(object.geometry.segment.start.col, object.geometry.segment.end.col)
      const bottom = Math.max(object.geometry.segment.start.row, object.geometry.segment.end.row)
      const right = Math.max(object.geometry.segment.start.col, object.geometry.segment.end.col)
      return {
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
      }
    }
    case 'polyline': {
      const points = object.geometry.segments.flatMap((segment) => [segment.start, segment.end])
      const rows = points.map((point) => point.row)
      const cols = points.map((point) => point.col)
      return {
        top: Math.min(...rows),
        left: Math.min(...cols),
        width: Math.max(...cols) - Math.min(...cols) + 1,
        height: Math.max(...rows) - Math.min(...rows) + 1,
      }
    }
    default:
      return null
  }
}

function getLiveObjectById(document, objectId) {
  return document?.objects?.find((object) => object.id === objectId) ?? null
}

function getLiveCanvasById(document, canvasId) {
  return document?.canvases?.find((canvas) => canvas.id === canvasId) ?? null
}

function getCanvasContentBounds(document, canvasId) {
  const objectBounds = (document?.objects ?? [])
    .filter((object) => object.canvasId === canvasId)
    .map((object) => getObjectBounds(object))
    .filter(Boolean)
  const canvas = getLiveCanvasById(document, canvasId)
  const portalViews = Array.isArray(canvas?.metadata?.portalViews) ? canvas.metadata.portalViews : []
  const portalBounds = portalViews.map((portal) => ({
    top: portal.rect.top,
    left: portal.rect.left,
    width: portal.rect.width,
    height: portal.rect.height,
  }))
  const bounds = [...objectBounds, ...portalBounds]
  if (bounds.length === 0) {
    return null
  }

  const top = Math.min(...bounds.map((entry) => entry.top))
  const left = Math.min(...bounds.map((entry) => entry.left))
  const right = Math.max(...bounds.map((entry) => entry.left + entry.width - 1))
  const bottom = Math.max(...bounds.map((entry) => entry.top + entry.height - 1))
  return {
    top,
    left,
    width: right - left + 1,
    height: bottom - top + 1,
  }
}

function getShrinkToFitCanvasSize(document, canvasId) {
  const canvas = getLiveCanvasById(document, canvasId)
  if (!canvas) return null

  const bounds = getCanvasContentBounds(document, canvasId)
  if (!bounds) {
    return {
      rows: Math.min(canvas.bounds.height, DEFAULT_CANVAS_ROWS),
      cols: Math.min(canvas.bounds.width, DEFAULT_CANVAS_COLS),
    }
  }

  return {
    rows: Math.max(1, bounds.top + bounds.height),
    cols: Math.max(1, bounds.left + bounds.width),
  }
}

function getSelectionCandidates(client, input = {}) {
  const canvasId = input.canvasId || client.getDocument().activeCanvasId
  const candidates = []
  const explicitSelection = client.getCollaboratorSelection({
    actorId: input.selectionActorId,
    sessionId: input.selectionSessionId,
    name: input.selectionName,
    canvasId,
  })

  if (explicitSelection?.selection?.objectIds?.length) {
    candidates.push({
      source: explicitSelection.collaborator.actorId || explicitSelection.collaborator.sessionId || explicitSelection.collaborator.name || 'selection',
      objectIds: explicitSelection.selection.objectIds,
    })
    return candidates
  }

  if (Array.isArray(client.selection?.objectIds) && client.selection.objectIds.length) {
    candidates.push({
      source: client.actorId || 'local-agent',
      objectIds: client.selection.objectIds,
    })
  }

  const collaboratorSelections = client
    .listCollaborators({ canvasId })
    .filter((collaborator) => Array.isArray(collaborator.selection?.objectIds) && collaborator.selection.objectIds.length > 0)
    .map((collaborator) => ({
      source: collaborator.actorId || collaborator.sessionId || collaborator.name || 'collaborator',
      objectIds: collaborator.selection.objectIds,
    }))

  for (const selection of collaboratorSelections) {
    candidates.push(selection)
  }

  return candidates
}

async function resolveTargetObjectId(client, targetToken, input = {}) {
  if (targetToken !== 'selected') {
    return {
      objectId: targetToken,
      source: 'explicit-id',
    }
  }

  const candidates = getSelectionCandidates(client, input)
  if (candidates.length === 0) {
    throw new Error(
      'target=selected requires a current selection. Pass selectionActorId/sessionId/name, or select one object first.',
    )
  }
  if (candidates.length > 1) {
    throw new Error(
      'target=selected is ambiguous because multiple collaborators have selections. Pass selectionActorId/sessionId/name.',
    )
  }
  if (candidates[0].objectIds.length !== 1) {
    throw new Error('target=selected requires exactly one selected object.')
  }

  return {
    objectId: candidates[0].objectIds[0],
    source: candidates[0].source,
  }
}

export function getLiveCanvasCommandHelp(input = '') {
  const value = String(input).trim().toLowerCase()
  if (!value) return LIVE_CANVAS_COMMANDS
  return LIVE_CANVAS_COMMANDS.filter(
    (command) =>
      command.name.startsWith(value) ||
      command.canonicalUsage.toLowerCase().includes(value) ||
      command.aliases?.some((alias) => alias.toLowerCase().includes(value)) ||
      command.description.toLowerCase().includes(value),
  )
}

/**
 * Parse either the canonical keyed syntax or the older positional aliases.
 * The normalized output intentionally keeps `target=selected` symbolic so the
 * caller can resolve it against the latest live collaborator selection.
 */
export function parseLiveCanvasCommand(input) {
  const value = String(input).trim()
  const commandName = value.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const rest = value.slice(commandName.length).trim()
  const named = parseNamedStringArgs(rest)
  let match = null

  if (commandName === 'box.create') {
    if ('top' in named || 'left' in named || 'width' in named || 'height' in named) {
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const width = ensurePositiveNumber(named.width, 'width')
      const height = ensurePositiveNumber(named.height, 'height')
      const title = named.title ?? named.label
      const body = named.body ?? named.text
      return {
        definition: findDefinition('box.create'),
        syntaxStyle: 'canonical',
        canonicalInput: `box.create top=${top} left=${left} width=${width} height=${height}${title ? ` title=${quoteCommandValue(title)}` : ''}${body ? ` body=${quoteCommandValue(body)}` : ''}`,
        command: {
          type: 'box.create',
          top,
          left,
          width,
          height,
          ...(title ? { title } : {}),
          ...(body ? { body } : {}),
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
        definition: findDefinition('box.create'),
        syntaxStyle: 'legacy',
        canonicalInput: `box.create top=${top} left=${left} width=${width} height=${height}${title ? ` title=${quoteCommandValue(title)}` : ''}${body ? ` body=${quoteCommandValue(body)}` : ''}`,
        command: {
          type: 'box.create',
          top,
          left,
          width,
          height,
          ...(title ? { title } : {}),
          ...(body ? { body } : {}),
        },
      }
    }
  }

  if (/^canvas\.status\s*$/i.test(value)) {
    return {
      definition: findDefinition('canvas.status'),
      syntaxStyle: 'canonical',
      canonicalInput: 'canvas.status',
      command: { type: 'canvas.status' },
    }
  }

  if (commandName === 'box.title') {
    if ('target' in named || 'title' in named) {
      const target = named.target ?? 'selected'
      const title = named.title ?? named.label
      if (!title) throw new Error('Missing title.')
      return {
        definition: findDefinition('box.title'),
        syntaxStyle: 'canonical',
        canonicalInput: `box.title target=${targetTokenSuffix(target)} title=${quoteCommandValue(title)}`,
        command: { type: 'box.title', target, title },
      }
    }

    match = value.match(/^box\.title\s+(\S+)\s+(.+)$/i)
    if (match) {
      const target = match[1]
      const title = parseCommandText(match[2])
      return {
        definition: findDefinition('box.title'),
        syntaxStyle: 'legacy',
        canonicalInput: `box.title target=${targetTokenSuffix(target)} title=${quoteCommandValue(title)}`,
        command: { type: 'box.title', target, title },
      }
    }
  }

  if (commandName === 'box.body' || commandName === 'text.set') {
    const definition = findDefinition(commandName === 'box.body' ? 'box.body' : 'text.set')
    if ('target' in named || 'body' in named || 'text' in named) {
      const target = named.target ?? 'selected'
      const text = named.body ?? named.text
      if (!text) throw new Error('Missing text.')
      return {
        definition,
        syntaxStyle: 'canonical',
        canonicalInput: `${commandName === 'box.body' ? 'box.body' : 'text.set'} target=${targetTokenSuffix(target)} ${commandName === 'box.body' ? 'body' : 'text'}=${quoteCommandValue(text)}`,
        command: { type: commandName === 'box.body' ? 'box.body' : 'text.set', target, text },
      }
    }

    match = value.match(/^(?:box\.body|text\.set)\s+(\S+)\s+(.+)$/i)
    if (match) {
      const target = match[1]
      const text = parseCommandText(match[2])
      return {
        definition,
        syntaxStyle: 'legacy',
        canonicalInput: `${commandName === 'box.body' ? 'box.body' : 'text.set'} target=${targetTokenSuffix(target)} ${commandName === 'box.body' ? 'body' : 'text'}=${quoteCommandValue(text)}`,
        command: { type: commandName === 'box.body' ? 'box.body' : 'text.set', target, text },
      }
    }
  }

  if (commandName === 'text.create') {
    if ('row' in named || 'col' in named || 'text' in named) {
      const row = ensureNumber(named.row, 'row')
      const col = ensureNumber(named.col, 'col')
      const text = named.text
      if (!text) throw new Error('Missing text.')
      return {
        definition: findDefinition('text.create'),
        syntaxStyle: 'canonical',
        canonicalInput: `text.create row=${row} col=${col} text=${quoteCommandValue(text)}`,
        command: { type: 'text.create', row, col, text },
      }
    }

    match = value.match(/^text\.create\s+(-?\d+)\s+(-?\d+)\s+(.+)$/i)
    if (match) {
      const row = Number(match[1])
      const col = Number(match[2])
      const text = parseCommandText(match[3])
      return {
        definition: findDefinition('text.create'),
        syntaxStyle: 'legacy',
        canonicalInput: `text.create row=${row} col=${col} text=${quoteCommandValue(text)}`,
        command: { type: 'text.create', row, col, text },
      }
    }
  }

  if (commandName === 'line.create') {
    const lowerNamedKeys = Object.fromEntries(Object.keys(named).map((key) => [key.toLowerCase(), true]))
    if ('fromrow' in lowerNamedKeys || 'fromRow' in named || 'toRow' in named) {
      const fromRow = ensureNumber(named.fromRow ?? named.fromrow, 'fromRow')
      const fromCol = ensureNumber(named.fromCol ?? named.fromcol, 'fromCol')
      const toRow = ensureNumber(named.toRow ?? named.torow, 'toRow')
      const toCol = ensureNumber(named.toCol ?? named.tocol, 'toCol')
      return {
        definition: findDefinition('line.create'),
        syntaxStyle: 'canonical',
        canonicalInput: `line.create fromRow=${fromRow} fromCol=${fromCol} toRow=${toRow} toCol=${toCol}`,
        command: { type: 'line.create', fromRow, fromCol, toRow, toCol },
      }
    }

    match = value.match(/^line\.create\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const fromRow = Number(match[1])
      const fromCol = Number(match[2])
      const toRow = Number(match[3])
      const toCol = Number(match[4])
      return {
        definition: findDefinition('line.create'),
        syntaxStyle: 'legacy',
        canonicalInput: `line.create fromRow=${fromRow} fromCol=${fromCol} toRow=${toRow} toCol=${toCol}`,
        command: { type: 'line.create', fromRow, fromCol, toRow, toCol },
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
        definition: findDefinition('canvas.read'),
        syntaxStyle: 'canonical',
        canonicalInput: `canvas.read top=${top} left=${left} width=${width} height=${height}`,
        command: { type: 'canvas.read', top, left, width, height },
      }
    }

    match = value.match(/^canvas\.read\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*$/i)
    if (match) {
      const top = Number(match[1])
      const left = Number(match[2])
      const width = Number(match[3])
      const height = Number(match[4])
      return {
        definition: findDefinition('canvas.read'),
        syntaxStyle: 'legacy',
        canonicalInput: `canvas.read top=${top} left=${left} width=${width} height=${height}`,
        command: { type: 'canvas.read', top, left, width, height },
      }
    }
  }

  if (commandName === 'canvas.apply') {
    const mode = named.mode === 'replace-region' ? 'replace-region' : 'upsert'
    if ('json' in named) {
      const objects = parseJsonSpecs(named.json)
      const clearTypes =
        typeof named.clearTypes === 'string' && named.clearTypes.trim().length > 0
          ? named.clearTypes.split(',').map((value) => value.trim()).filter(Boolean)
          : undefined
      return {
        definition: findDefinition('canvas.apply'),
        syntaxStyle: 'canonical',
        canonicalInput: `canvas.apply mode=${mode}${Number.isFinite(Number(named.top)) ? ` top=${Number(named.top)}` : ''}${Number.isFinite(Number(named.left)) ? ` left=${Number(named.left)}` : ''}${Number.isFinite(Number(named.width)) ? ` width=${Number(named.width)}` : ''}${Number.isFinite(Number(named.height)) ? ` height=${Number(named.height)}` : ''}${clearTypes?.length ? ` clearTypes=${quoteCommandValue(clearTypes.join(','))}` : ''} json=${quoteCommandValue(named.json)}`,
        command: {
          type: 'canvas.apply',
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

  if (commandName === 'canvas.resize') {
    if ('rows' in named || 'cols' in named) {
      const rows = ensurePositiveNumber(named.rows, 'rows')
      const cols = ensurePositiveNumber(named.cols, 'cols')
      return {
        definition: findDefinition('canvas.resize'),
        syntaxStyle: 'canonical',
        canonicalInput: `canvas.resize rows=${rows} cols=${cols}`,
        command: { type: 'canvas.resize', rows, cols },
      }
    }

    match = value.match(/^canvas\.resize\s+(\d+)\s+(\d+)\s*$/i)
    if (match) {
      const rows = Number(match[1])
      const cols = Number(match[2])
      return {
        definition: findDefinition('canvas.resize'),
        syntaxStyle: 'legacy',
        canonicalInput: `canvas.resize rows=${rows} cols=${cols}`,
        command: { type: 'canvas.resize', rows, cols },
      }
    }
  }

  if (commandName === 'canvas.expand') {
    if (rest.length === 0 || 'rows' in named || 'cols' in named) {
      const rows = named.rows != null ? ensureNumber(named.rows, 'rows') : DEFAULT_EXPAND_ROWS
      const cols = named.cols != null ? ensureNumber(named.cols, 'cols') : DEFAULT_EXPAND_COLS
      return {
        definition: findDefinition('canvas.expand'),
        syntaxStyle: rest.length === 0 ? 'legacy' : 'canonical',
        canonicalInput: `canvas.expand rows=${rows} cols=${cols}`,
        command: { type: 'canvas.expand', rows, cols },
      }
    }

    match = value.match(/^canvas\.expand\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const rows = Number(match[1])
      const cols = Number(match[2])
      return {
        definition: findDefinition('canvas.expand'),
        syntaxStyle: 'legacy',
        canonicalInput: `canvas.expand rows=${rows} cols=${cols}`,
        command: { type: 'canvas.expand', rows, cols },
      }
    }
  }

  if (/^canvas\.shrink\s*$/i.test(value)) {
    return {
      definition: findDefinition('canvas.shrink'),
      syntaxStyle: 'canonical',
      canonicalInput: 'canvas.shrink',
      command: { type: 'canvas.shrink' },
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
        definition: findDefinition('objects.move'),
        syntaxStyle: 'canonical',
        canonicalInput: `objects.move ids=${quoteCommandValue(objectIds.join(','))} deltaRow=${deltaRow} deltaCol=${deltaCol}`,
        command: { type: 'objects.move', objectIds, deltaRow, deltaCol },
      }
    }

    match = value.match(/^objects\.move\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const objectIds = match[1].split(',').map((value) => value.trim()).filter(Boolean)
      const deltaRow = Number(match[2])
      const deltaCol = Number(match[3])
      return {
        definition: findDefinition('objects.move'),
        syntaxStyle: 'legacy',
        canonicalInput: `objects.move ids=${quoteCommandValue(objectIds.join(','))} deltaRow=${deltaRow} deltaCol=${deltaCol}`,
        command: { type: 'objects.move', objectIds, deltaRow, deltaCol },
      }
    }
  }

  if (commandName === 'objects.find') {
    const objectTypes =
      typeof named.types === 'string' && named.types.trim().length > 0
        ? named.types.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined
    return {
      definition: findDefinition('objects.find'),
      syntaxStyle: 'canonical',
      canonicalInput:
        `objects.find${named.type ? ` type=${named.type}` : ''}${objectTypes?.length ? ` types=${quoteCommandValue(objectTypes.join(','))}` : ''}${named.text ? ` text=${quoteCommandValue(named.text)}` : ''}${named.title ? ` title=${quoteCommandValue(named.title)}` : ''}${named.withinTop != null ? ` withinTop=${ensureNumber(named.withinTop, 'withinTop')}` : ''}${named.withinLeft != null ? ` withinLeft=${ensureNumber(named.withinLeft, 'withinLeft')}` : ''}${named.withinWidth != null ? ` withinWidth=${ensurePositiveNumber(named.withinWidth, 'withinWidth')}` : ''}${named.withinHeight != null ? ` withinHeight=${ensurePositiveNumber(named.withinHeight, 'withinHeight')}` : ''}`,
      command: {
        type: 'objects.find',
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
    const objects = parseJsonSpecs(named.json)
    return {
      definition: findDefinition('objects.replace'),
      syntaxStyle: 'canonical',
      canonicalInput: `objects.replace ids=${quoteCommandValue(objectIds.join(','))} json=${quoteCommandValue(named.json)}`,
      command: { type: 'objects.replace', objectIds, objects },
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
        ? 'shared'
        : ensureNumber(gapValue, 'gap')
    return {
      definition: findDefinition('stack.pack'),
      syntaxStyle: 'canonical',
      canonicalInput: `stack.pack ids=${quoteCommandValue(objectIds.join(','))} axis=${axis} gap=${gap === 'shared' ? 'shared' : gap} align=${align}`,
      command: { type: 'stack.pack', objectIds, axis, gap, align },
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
      definition: findDefinition('objects.align'),
      syntaxStyle: 'canonical',
      canonicalInput: `objects.align ids=${quoteCommandValue(objectIds.join(','))} edge=${edge}`,
      command: { type: 'objects.align', objectIds, edge },
    }
  }

  if (commandName === 'object.update') {
    const target = named.target ?? 'selected'
    const hasPatchField = ['top', 'left', 'width', 'height', 'row', 'col', 'title', 'text', 'body', 'align']
      .some((key) => key in named)
    if (!hasPatchField) {
      throw new Error('Provide at least one patch field.')
    }
    const align = named.align ? String(named.align).toUpperCase() : null
    if (align && !['LEFT', 'CENTER', 'RIGHT'].includes(align)) {
      throw new Error('align must be left, center, or right.')
    }
    const parts = [`object.update target=${targetTokenSuffix(target)}`]
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
      definition: findDefinition('object.update'),
      syntaxStyle: 'canonical',
      canonicalInput: parts.join(' '),
      command: {
        type: 'object.update',
        target,
        ...(named.top != null ? { top: ensureNumber(named.top, 'top') } : {}),
        ...(named.left != null ? { left: ensureNumber(named.left, 'left') } : {}),
        ...(named.width != null ? { width: ensurePositiveNumber(named.width, 'width') } : {}),
        ...(named.height != null ? { height: ensurePositiveNumber(named.height, 'height') } : {}),
        ...(named.row != null ? { row: ensureNumber(named.row, 'row') } : {}),
        ...(named.col != null ? { col: ensureNumber(named.col, 'col') } : {}),
        ...(named.title != null ? { title: named.title } : {}),
        ...(named.body != null ? { body: named.body } : {}),
        ...(named.text != null ? { text: named.text } : {}),
        ...(align ? { alignment: align } : {}),
      },
    }
  }

  if (commandName === 'object.move') {
    if ('target' in named || 'top' in named || 'left' in named) {
      const target = named.target ?? 'selected'
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      return {
        definition: findDefinition('object.move'),
        syntaxStyle: 'canonical',
        canonicalInput: `object.move target=${targetTokenSuffix(target)} top=${top} left=${left}`,
        command: { type: 'object.move', target, top, left },
      }
    }

    match = value.match(/^object\.move\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s*$/i)
    if (match) {
      const target = match[1]
      const top = Number(match[2])
      const left = Number(match[3])
      return {
        definition: findDefinition('object.move'),
        syntaxStyle: 'legacy',
        canonicalInput: `object.move target=${targetTokenSuffix(target)} top=${top} left=${left}`,
        command: { type: 'object.move', target, top, left },
      }
    }
  }

  if (commandName === 'object.resize') {
    if ('target' in named || 'top' in named || 'left' in named || 'width' in named || 'height' in named) {
      const target = named.target ?? 'selected'
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const width = ensurePositiveNumber(named.width, 'width')
      const height = ensurePositiveNumber(named.height, 'height')
      return {
        definition: findDefinition('object.resize'),
        syntaxStyle: 'canonical',
        canonicalInput: `object.resize target=${targetTokenSuffix(target)} top=${top} left=${left} width=${width} height=${height}`,
        command: { type: 'object.resize', target, top, left, width, height },
      }
    }

    match = value.match(/^object\.resize\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*$/i)
    if (match) {
      const target = match[1]
      const top = Number(match[2])
      const left = Number(match[3])
      const width = Number(match[4])
      const height = Number(match[5])
      return {
        definition: findDefinition('object.resize'),
        syntaxStyle: 'legacy',
        canonicalInput: `object.resize target=${targetTokenSuffix(target)} top=${top} left=${left} width=${width} height=${height}`,
        command: { type: 'object.resize', target, top, left, width, height },
      }
    }
  }

  if (commandName === 'object.delete') {
    if ('target' in named) {
      const target = named.target
      return {
        definition: findDefinition('object.delete'),
        syntaxStyle: 'canonical',
        canonicalInput: `object.delete target=${targetTokenSuffix(target)}`,
        command: { type: 'object.delete', target },
      }
    }
    match = value.match(/^object\.delete\s+(\S+)\s*$/i)
    if (match) {
      const target = match[1]
      return {
        definition: findDefinition('object.delete'),
        syntaxStyle: 'legacy',
        canonicalInput: `object.delete target=${targetTokenSuffix(target)}`,
        command: { type: 'object.delete', target },
      }
    }
  }

  if (commandName === 'text.align') {
    if ('target' in named || 'align' in named) {
      const target = named.target ?? 'selected'
      const alignment = (named.align ?? '').toUpperCase()
      if (!['LEFT', 'CENTER', 'RIGHT'].includes(alignment)) {
        throw new Error('align must be left, center, or right.')
      }
      return {
        definition: findDefinition('text.align'),
        syntaxStyle: 'canonical',
        canonicalInput: `text.align target=${targetTokenSuffix(target)} align=${alignment.toLowerCase()}`,
        command: { type: 'text.align', target, alignment },
      }
    }

    match = value.match(/^text\.align\s+(\S+)\s+(left|center|right)\s*$/i)
    if (match) {
      const target = match[1]
      const alignment = match[2].toUpperCase()
      return {
        definition: findDefinition('text.align'),
        syntaxStyle: 'legacy',
        canonicalInput: `text.align target=${targetTokenSuffix(target)} align=${alignment.toLowerCase()}`,
        command: { type: 'text.align', target, alignment },
      }
    }
  }

  if (commandName === 'text.enclose') {
    if ('target' in named || 'padding' in named) {
      const target = named.target ?? 'selected'
      const padding = named.padding ? ensurePositiveNumber(named.padding, 'padding') : undefined
      return {
        definition: findDefinition('text.enclose'),
        syntaxStyle: 'canonical',
        canonicalInput: `text.enclose target=${targetTokenSuffix(target)}${padding != null ? ` padding=${padding}` : ''}`,
        command: { type: 'text.enclose', target, ...(padding != null ? { padding } : {}) },
      }
    }

    match = value.match(/^text\.enclose\s+(\S+)(?:\s+(\d+))?\s*$/i)
    if (match) {
      const target = match[1]
      const padding = match[2] ? Number(match[2]) : undefined
      return {
        definition: findDefinition('text.enclose'),
        syntaxStyle: 'legacy',
        canonicalInput: `text.enclose target=${targetTokenSuffix(target)}${padding != null ? ` padding=${padding}` : ''}`,
        command: { type: 'text.enclose', target, ...(padding != null ? { padding } : {}) },
      }
    }
  }

  const exactCommand = findDefinition(commandName)
  if (exactCommand) {
    throw new Error(`Usage: ${exactCommand.canonicalUsage}`)
  }

  throw new Error(`Unknown command. Try: ${LIVE_CANVAS_COMMANDS.map((command) => command.name).join(', ')}.`)
}

export function buildLiveCanvasCommandPreview(input, options = {}) {
  const value = String(input ?? '').trim()
  if (!value) return null

  const commandName = value.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const numbers = getLeadingNumbers(value)
  const named = parseNamedStringArgs(value.slice(commandName.length).trim())
  const canvasId = options.canvasId ?? options.document?.activeCanvasId ?? null
  const canvas = canvasId ? getLiveCanvasById(options.document, canvasId) : null

  if (commandName === 'box.create') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const width = named.width != null ? Number(named.width) : numbers[2]
    const height = named.height != null ? Number(named.height) : numbers[3]
    if ([top, left, width, height].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId,
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
        canvasId,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Box anchor at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type top and left to preview the box anchor.' }
  }

  if (commandName === 'text.create') {
    const row = named.row != null ? Number(named.row) : numbers[0]
    const col = named.col != null ? Number(named.col) : numbers[1]
    if (Number.isFinite(row)) {
      return {
        kind: 'point',
        canvasId,
        row,
        col: Number.isFinite(col) ? col : 0,
        label: `Text cursor at (${row}, ${Number.isFinite(col) ? col : 0})`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type row and col to preview text placement.' }
  }

  if (commandName === 'line.create') {
    const fromRow = named.fromRow != null ? Number(named.fromRow) : numbers[0]
    const fromCol = named.fromCol != null ? Number(named.fromCol) : numbers[1]
    const toRow = named.toRow != null ? Number(named.toRow) : numbers[2]
    const toCol = named.toCol != null ? Number(named.toCol) : numbers[3]
    if ([fromRow, fromCol, toRow, toCol].every(Number.isFinite)) {
      return {
        kind: 'line',
        canvasId,
        from: { row: fromRow, col: fromCol },
        to: { row: toRow, col: toCol },
        label: `Line from (${fromRow}, ${fromCol}) to (${toRow}, ${toCol})`,
      }
    }
    if (Number.isFinite(fromRow)) {
      return {
        kind: 'point',
        canvasId,
        row: fromRow,
        col: Number.isFinite(fromCol) ? fromCol : 0,
        label: `Line start at (${fromRow}, ${Number.isFinite(fromCol) ? fromCol : 0})`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type line coordinates to preview the connector.' }
  }

  if (commandName === 'canvas.read') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const width = named.width != null ? Number(named.width) : numbers[2]
    const height = named.height != null ? Number(named.height) : numbers[3]
    if ([top, left, width, height].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId,
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
        canvasId,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Region start at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type top/left/width/height to preview the read region.' }
  }

  if (commandName === 'canvas.resize') {
    const rows = named.rows != null ? Number(named.rows) : numbers[0]
    const cols = named.cols != null ? Number(named.cols) : numbers[1]
    if ([rows, cols].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId,
        top: 0,
        left: 0,
        width: Math.max(1, cols),
        height: Math.max(1, rows),
        label: `Resize canvas to ${Math.max(1, rows)} rows × ${Math.max(1, cols)} cols`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type rows and cols to preview the resized canvas bounds.' }
  }

  if (commandName === 'canvas.expand') {
    const rowDelta = named.rows != null ? Number(named.rows) : Number.isFinite(numbers[0]) ? numbers[0] : DEFAULT_EXPAND_ROWS
    const colDelta = named.cols != null ? Number(named.cols) : Number.isFinite(numbers[1]) ? numbers[1] : DEFAULT_EXPAND_COLS
    const baseRows = canvas?.bounds?.height ?? DEFAULT_CANVAS_ROWS
    const baseCols = canvas?.bounds?.width ?? DEFAULT_CANVAS_COLS
    if ([rowDelta, colDelta].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId,
        top: 0,
        left: 0,
        width: Math.max(1, baseCols + Math.max(0, colDelta)),
        height: Math.max(1, baseRows + Math.max(0, rowDelta)),
        label: `Expand canvas by ${Math.max(0, rowDelta)} rows and ${Math.max(0, colDelta)} cols`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type row/col deltas to preview the expanded canvas.' }
  }

  if (commandName === 'canvas.shrink') {
    const nextSize = canvasId ? getShrinkToFitCanvasSize(options.document, canvasId) : null
    if (nextSize) {
      return {
        kind: 'rect',
        canvasId,
        top: 0,
        left: 0,
        width: nextSize.cols,
        height: nextSize.rows,
        label: `Shrink canvas to ${nextSize.rows} rows × ${nextSize.cols} cols`,
      }
    }
    return { kind: 'info', canvasId, label: 'Shrink canvas to the current content bounds.' }
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
                : spec.points?.length > 0
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
            canvasId,
            top,
            left,
            width: right - left + 1,
            height: bottom - top + 1,
            label: `Apply ${objects.length} objects`,
          }
        }
      } catch {
        return { kind: 'info', canvasId, label: 'Type a valid JSON array to preview the bulk apply.' }
      }
    }
  }

  if (commandName === 'objects.move') {
    const rawIds = named.ids ?? named.objects ?? ''
    const objectIds = rawIds.split(',').map((value) => value.trim()).filter(Boolean)
    const deltaRow = named.deltaRow != null ? Number(named.deltaRow) : named.deltarow != null ? Number(named.deltarow) : numbers[1]
    const deltaCol = named.deltaCol != null ? Number(named.deltaCol) : named.deltacol != null ? Number(named.deltacol) : numbers[2]
    if (options.document && objectIds.length > 0) {
      const bounds = objectIds
        .map((objectId) => getObjectBounds(getLiveObjectById(options.document, objectId)))
        .filter(Boolean)
      if (bounds.length > 0 && [deltaRow, deltaCol].every(Number.isFinite)) {
        const top = Math.min(...bounds.map((entry) => entry.top)) + deltaRow
        const left = Math.min(...bounds.map((entry) => entry.left)) + deltaCol
        const right = Math.max(...bounds.map((entry) => entry.left + entry.width - 1)) + deltaCol
        const bottom = Math.max(...bounds.map((entry) => entry.top + entry.height - 1)) + deltaRow
        return {
          kind: 'rect',
          canvasId,
          top,
          left,
          width: right - left + 1,
          height: bottom - top + 1,
          label: `Move ${bounds.length} objects`,
        }
      }
    }
    if (objectIds.length > 0) {
      return { kind: 'info', canvasId, label: `Move ${objectIds.length} objects by deltaRow/deltaCol.` }
    }
  }

  if (commandName === 'objects.find') {
    const top = named.withinTop != null ? Number(named.withinTop) : null
    const left = named.withinLeft != null ? Number(named.withinLeft) : null
    const width = named.withinWidth != null ? Number(named.withinWidth) : null
    const height = named.withinHeight != null ? Number(named.withinHeight) : null
    if ([top, left, width, height].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId,
        top,
        left,
        width,
        height,
        label: 'Find objects in region',
      }
    }
    return { kind: 'info', canvasId, label: 'Find objects by type/text/title and optional region.' }
  }

  if (commandName === 'objects.replace') {
    if (typeof named.json === 'string') {
      try {
        const objects = parseJsonSpecs(named.json)
        if (objects.length > 0) {
          const rects = objects.map((spec) => {
            if (spec.type === 'rectangle') return { top: spec.top, left: spec.left, width: spec.width, height: spec.height }
            if (spec.type === 'text') {
              const lines = spec.lines ?? String(spec.text ?? '').split('\n')
              return { top: spec.row, left: spec.col, width: Math.max(1, ...lines.map((line) => line.length)), height: Math.max(1, lines.length) }
            }
            return null
          }).filter(Boolean)
          if (rects.length > 0) {
            const top = Math.min(...rects.map((rect) => rect.top))
            const left = Math.min(...rects.map((rect) => rect.left))
            const right = Math.max(...rects.map((rect) => rect.left + rect.width - 1))
            const bottom = Math.max(...rects.map((rect) => rect.top + rect.height - 1))
            return { kind: 'rect', canvasId, top, left, width: right - left + 1, height: bottom - top + 1, label: `Replace with ${objects.length} objects` }
          }
        }
      } catch {}
    }
    return { kind: 'info', canvasId, label: 'Delete exact ids and draw the replacement objects.' }
  }

  if (commandName === 'stack.pack') {
    return { kind: 'info', canvasId, label: 'Pack the listed objects into a stack.' }
  }

  if (commandName === 'objects.align') {
    return { kind: 'info', canvasId, label: 'Align the listed objects to one edge.' }
  }

  if (commandName === 'object.update') {
    const top = named.top != null ? Number(named.top) : named.row != null ? Number(named.row) : null
    const left = named.left != null ? Number(named.left) : named.col != null ? Number(named.col) : null
    const width = named.width != null ? Number(named.width) : null
    const height = named.height != null ? Number(named.height) : null
    if ([top, left, width, height].every(Number.isFinite)) {
      return { kind: 'rect', canvasId, top, left, width, height, label: 'Patch target bounds' }
    }
    if ([top, left].every(Number.isFinite)) {
      return { kind: 'point', canvasId, row: top, col: left, label: 'Patch target anchor' }
    }
    return { kind: 'info', canvasId, label: 'Patch one object in place.' }
  }

  if (commandName === 'object.move') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    if (Number.isFinite(top)) {
      return {
        kind: 'point',
        canvasId,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Move target at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type top and left to preview move target.' }
  }

  if (commandName === 'object.resize') {
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const width = named.width != null ? Number(named.width) : numbers[2]
    const height = named.height != null ? Number(named.height) : numbers[3]
    if ([top, left, width, height].every(Number.isFinite)) {
      return {
        kind: 'rect',
        canvasId,
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
        canvasId,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Resize anchor at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', canvasId, label: 'Type top/left/width/height to preview resize.' }
  }

  return null
}

/**
 * Execute a parsed live command against the websocket-native agent client.
 * The caller gets back both the normalized command and the fresh document
 * snapshot so it can show exact feedback immediately.
 */
export async function executeLiveCanvasCommand(client, parsed, input = {}) {
  const document = client.getDocument()
  const canvasId = input.canvasId || document.activeCanvasId
  const safeExpectedRevision =
    Number.isInteger(input.expectedRevision)
      ? input.expectedRevision
      : parsed.command.type === 'canvas.read' || parsed.command.type === 'objects.find'
        ? undefined
        : document.version ?? undefined
  const baseResult = {
    command: parsed.command.type,
    syntaxStyle: parsed.syntaxStyle,
    canonicalInput: parsed.canonicalInput,
    description: parsed.definition?.description ?? null,
  }

  const withConflictContext = (error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!/Revision mismatch/i.test(message)) {
      throw error
    }
    const latest = client.getDocument()
    throw new Error(
      `${message} Latest revision is ${latest.version ?? 0}. Re-run objects.find or canvas.read, then retry the command.`,
    )
  }

  if (parsed.command.type === 'canvas.status') {
    const latest = client.getDocument()
    const collaborators = client.listCollaborators({ canvasId })
    const self =
      collaborators.find((entry) => entry.actorId === client.actorId || entry.sessionId === client.sessionId) ?? null
    return {
      ...baseResult,
      liveReady: true,
      requestedCanvasId: client.requestedCanvasId ?? client.canvasId,
      activeCanvasId: latest.activeCanvasId,
      canvasId,
      documentId: client.documentId,
      revision: latest.version ?? 0,
      actorId: client.actorId,
      sessionId: client.sessionId,
      collaboratorCount: collaborators.length,
      self,
      collaborators,
    }
  }

  if (parsed.command.type === 'box.create') {
    try {
      await client.createWireframeRectangle({
        canvasId,
        top: parsed.command.top,
        left: parsed.command.left,
        width: parsed.command.width,
        height: parsed.command.height,
        label: parsed.command.title,
        labelLines: parsed.command.body ? parsed.command.body.split('\n') : undefined,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'text.create') {
    try {
      await client.createText({
        canvasId,
        row: parsed.command.row,
        col: parsed.command.col,
        lines: parsed.command.text.split('\n'),
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'line.create') {
    try {
      await client.createLine({
        canvasId,
        from: { row: parsed.command.fromRow, col: parsed.command.fromCol },
        to: { row: parsed.command.toRow, col: parsed.command.toCol },
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'canvas.read') {
    return {
      ...baseResult,
      region: client.getCanvasRegionSnapshot({
        canvasId,
        top: parsed.command.top,
        left: parsed.command.left,
        width: parsed.command.width,
        height: parsed.command.height,
      }),
    }
  }

  if (parsed.command.type === 'canvas.apply') {
    let result
    try {
      result = await client.applyCanvasJson({
        canvasId,
        mode: parsed.command.mode,
        objects: parsed.command.objects,
        top: parsed.command.top,
        left: parsed.command.left,
        width: parsed.command.width,
        height: parsed.command.height,
        clearTypes: parsed.command.clearTypes,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      mode: result.mode,
      upsertedObjectIds: result.upsertedObjectIds,
      deletedObjectIds: result.deletedObjectIds,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'canvas.resize') {
    try {
      await client.setCanvasSize({
        canvasId,
        rows: parsed.command.rows,
        cols: parsed.command.cols,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'canvas.expand') {
    try {
      await client.expandCanvas({
        canvasId,
        rows: parsed.command.rows,
        cols: parsed.command.cols,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'canvas.shrink') {
    try {
      await client.shrinkCanvasToFit({
        canvasId,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'objects.move') {
    let result
    try {
      result = await client.moveObjects({
        objectIds: parsed.command.objectIds,
        deltaRow: parsed.command.deltaRow,
        deltaCol: parsed.command.deltaCol,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      movedObjectIds: result.movedObjectIds,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'objects.find') {
    return {
      ...baseResult,
      objects: client.findObjects({
        canvasId,
        ...(parsed.command.objectType ? { type: parsed.command.objectType } : {}),
        ...(parsed.command.objectTypes?.length ? { types: parsed.command.objectTypes } : {}),
        ...(parsed.command.textContains ? { textContains: parsed.command.textContains } : {}),
        ...(parsed.command.labelContains ? { labelContains: parsed.command.labelContains } : {}),
        ...(parsed.command.withinTop != null ? { withinTop: parsed.command.withinTop } : {}),
        ...(parsed.command.withinLeft != null ? { withinLeft: parsed.command.withinLeft } : {}),
        ...(parsed.command.withinWidth != null ? { withinWidth: parsed.command.withinWidth } : {}),
        ...(parsed.command.withinHeight != null ? { withinHeight: parsed.command.withinHeight } : {}),
      }),
    }
  }

  if (parsed.command.type === 'objects.replace') {
    let result
    try {
      result = await client.replaceObjects({
        canvasId,
        objectIds: parsed.command.objectIds,
        objects: parsed.command.objects,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      deletedObjectIds: result.deletedObjectIds,
      upsertedObjectIds: result.upsertedObjectIds,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'stack.pack') {
    let result
    try {
      result = await client.packObjects({
        canvasId,
        objectIds: parsed.command.objectIds,
        axis: parsed.command.axis,
        gap: parsed.command.gap,
        align: parsed.command.align,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      objectIds: result.objectIds,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'objects.align') {
    let result
    try {
      result = await client.alignObjects({
        canvasId,
        objectIds: parsed.command.objectIds,
        edge: parsed.command.edge,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      objectIds: result.objectIds,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  const resolvedTarget = await resolveTargetObjectId(client, parsed.command.target, input)
  const objectId = resolvedTarget.objectId

  if (parsed.command.type === 'object.update') {
    try {
      await client.patchObject({
        objectId,
        ...(parsed.command.top != null ? { top: parsed.command.top } : {}),
        ...(parsed.command.left != null ? { left: parsed.command.left } : {}),
        ...(parsed.command.width != null ? { width: parsed.command.width } : {}),
        ...(parsed.command.height != null ? { height: parsed.command.height } : {}),
        ...(parsed.command.row != null ? { row: parsed.command.row } : {}),
        ...(parsed.command.col != null ? { col: parsed.command.col } : {}),
        ...(parsed.command.title != null ? { title: parsed.command.title } : {}),
        ...(parsed.command.body != null ? { body: parsed.command.body } : {}),
        ...(parsed.command.text != null ? { text: parsed.command.text } : {}),
        ...(parsed.command.alignment ? { alignment: parsed.command.alignment } : {}),
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'box.title') {
    try {
      await client.setRectangleLabel({
        objectId,
        text: parsed.command.title,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'box.body' || parsed.command.type === 'text.set') {
    try {
      await client.setText({
        objectId,
        text: parsed.command.text,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'text.align') {
    try {
      await client.setTextAlignment({
        objectId,
        alignment: parsed.command.alignment,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'text.enclose') {
    try {
      await client.encloseText({
        objectId,
        padding: parsed.command.padding,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'object.delete') {
    try {
      await client.deleteObject({
        objectId,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'object.resize') {
    try {
      await client.resizeObject({
        objectId,
        top: parsed.command.top,
        left: parsed.command.left,
        width: parsed.command.width,
        height: parsed.command.height,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  if (parsed.command.type === 'object.move') {
    const latestDocument = client.getDocument()
    const object = getLiveObjectById(latestDocument, objectId)
    if (!object) {
      throw new Error(`Object ${objectId} was not found.`)
    }
    const anchor = getObjectAnchor(object)
    if (!anchor) {
      throw new Error(`Object ${objectId} does not support absolute move.`)
    }
    try {
      await client.moveObject({
        objectId,
        deltaRow: parsed.command.top - anchor.row,
        deltaCol: parsed.command.left - anchor.col,
        expectedRevision: safeExpectedRevision,
      })
    } catch (error) {
      withConflictContext(error)
    }
    return {
      ...baseResult,
      resolvedTargetObjectId: objectId,
      resolvedTargetSource: resolvedTarget.source,
      snapshot: client.getCanvasSnapshot({ canvasId }),
    }
  }

  throw new Error(`Unsupported live canvas command: ${parsed.command.type}`)
}
