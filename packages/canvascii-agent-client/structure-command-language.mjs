/**
 * Shared canvas-structure command grammar for humans and agents.
 *
 * This module covers document-level structure changes rather than room-local
 * object edits:
 * - pages
 * - groups
 * - components
 *
 * The commands are intentionally pure state transforms so the browser terminal,
 * MCP server, and any future API surface can all reuse the same semantics.
 */
import { createUniqueCanvasName } from './canvas-names.mjs'

const DEFAULT_CANVAS_SIZE = {
  rows: 75,
  cols: 250,
}

const COMPONENT_COLOR = '#f59e0b'

export const CANVAS_STRUCTURE_COMMANDS = [
  {
    name: 'page.new',
    canonicalUsage: 'page.new name="Checkout flow" parent="root"',
    aliases: ['page.new Checkout flow', 'diagram.new Checkout flow'],
    description: 'Create a nested canvas under the current canvas, or at the root level.',
  },
  {
    name: 'page.open',
    canonicalUsage: 'page.open target="Checkout flow"',
    aliases: ['page.open 2', 'diagram.switch 2'],
    description: 'Open a page by index, id, or fuzzy name match.',
  },
  {
    name: 'page.list',
    canonicalUsage: 'page.list',
    aliases: ['diagram.list'],
    description: 'List the nested page tree in the current canvas.',
  },
  {
    name: 'page.rename',
    canonicalUsage: 'page.rename target="Checkout flow" name="Checkout"',
    description: 'Rename a canvas by id, index, or fuzzy name match.',
  },
  {
    name: 'page.duplicate',
    canonicalUsage: 'page.duplicate target="Checkout flow"',
    description: 'Duplicate a canvas as a sibling copy.',
  },
  {
    name: 'page.delete',
    canonicalUsage: 'page.delete target="Checkout flow"',
    description: 'Delete a canvas and its nested children.',
  },
  {
    name: 'group.create',
    canonicalUsage: 'group.create objects="id-1,id-2"',
    aliases: ['group.create selected'],
    description: 'Turn the current multi-selection, or explicit object ids, into a durable group.',
  },
  {
    name: 'group.break',
    canonicalUsage: 'group.break objects="id-1,id-2"',
    aliases: ['group.break selected'],
    description: 'Remove grouping from the current selection, or explicit object ids.',
  },
  {
    name: 'component.mark',
    canonicalUsage: 'component.mark',
    description: 'Turn the current page into a reusable component definition.',
  },
  {
    name: 'component.unmark',
    canonicalUsage: 'component.unmark',
    description: 'Turn the current component page back into a normal page.',
  },
  {
    name: 'component.create',
    canonicalUsage: 'component.create name="Button" objects="id-1,id-2" attr.label="Save" attr.variant="primary"',
    aliases: ['component.create Button'],
    description: 'Extract the current selection, or explicit object ids, into a child component canvas, with optional attributes.',
  },
  {
    name: 'component.attr',
    canonicalUsage: 'component.attr add key=label default="Save"',
    aliases: ['component.attr add label default="Save"', 'component.attr remove label'],
    description: 'Add, update, or remove component attributes.',
  },
  {
    name: 'component.use',
    canonicalUsage: 'component.use source="Button" top=12 left=40 label="Save"',
    aliases: ['component.use Button 12 40 label="Save"'],
    description: 'Insert a component instance with prop overrides.',
  },
]

export function getStructureCanvasCommandHelp(input = '') {
  const value = String(input).trim().toLowerCase()
  if (!value) return CANVAS_STRUCTURE_COMMANDS
  return CANVAS_STRUCTURE_COMMANDS.filter(
    (command) =>
      command.name.startsWith(value) ||
      command.canonicalUsage.toLowerCase().includes(value) ||
      command.aliases?.some((alias) => alias.toLowerCase().includes(value)) ||
      command.description.toLowerCase().includes(value),
  )
}

export function isStructureCanvasCommandName(name = '') {
  const lower = String(name).trim().toLowerCase()
  if (!lower) return false
  return CANVAS_STRUCTURE_COMMANDS.some(
    (command) =>
      command.name === lower ||
      command.aliases?.some((alias) => alias.split(/\s+/, 1)[0]?.toLowerCase() === lower),
  )
}

function findDefinition(name) {
  return CANVAS_STRUCTURE_COMMANDS.find((command) => command.name === name) ?? null
}

function parseCommandText(value) {
  return String(value ?? '').replace(/\\n/g, '\n')
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

function parseObjectIdList(value) {
  return [...new Set(String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))]
}

function getLeadingNumbers(input) {
  const matches = String(input).match(/-?\d+/g) ?? []
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

function createClientCanvasId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneJsonValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

function initDiagramData(input = {}) {
  return {
    canvasSize: {
      rows: input.canvasSize?.rows ?? DEFAULT_CANVAS_SIZE.rows,
      cols: input.canvasSize?.cols ?? DEFAULT_CANVAS_SIZE.cols,
    },
    shapes: Array.isArray(input.shapes) ? input.shapes : [],
    groups: Array.isArray(input.groups) ? input.groups : [],
    portalViews: Array.isArray(input.portalViews) ? input.portalViews : [],
    styleMode: input.styleMode ?? 'UNICODE',
    globalStyle: input.globalStyle ?? {
      lineStyle: 'LIGHT',
      rectangleFill: 'NONE',
      rectangleBorder: 'AUTO',
      rectangleTextAlignH: 'LEFT',
      rectangleTextAlignV: 'TOP',
      rectangleTextWrap: 'WORD',
      rectangleTextOverflow: 'TRUNCATE',
      rectangleTextPadding: 0,
      lineTextAlign: 'CENTER',
      lineTextPadding: 0,
      arrowHead: 'NONE',
      arrowHeadStyle: 'OUTLINE',
    },
  }
}

export function getActivePage(state) {
  return state.diagrams.find((diagram) => diagram.id === state.activeDiagramId) ?? state.diagrams[0] ?? null
}

export function getChildPages(state, parentCanvasId) {
  return state.diagrams.filter((diagram) => (diagram.parentCanvasId ?? null) === (parentCanvasId ?? null))
}

export function getPageAncestors(state, canvasId) {
  const byId = new Map(state.diagrams.map((diagram) => [diagram.id, diagram]))
  const trail = []
  let cursor = byId.get(canvasId) ?? null
  while (cursor) {
    trail.unshift(cursor)
    cursor = cursor.parentCanvasId ? byId.get(cursor.parentCanvasId) ?? null : null
  }
  return trail
}

function getDescendantPages(state, canvasId) {
  const descendants = []
  const queue = [...getChildPages(state, canvasId)]
  while (queue.length > 0) {
    const next = queue.shift()
    if (!next) continue
    descendants.push(next)
    queue.push(...getChildPages(state, next.id))
  }
  return descendants
}

function resolvePageParentId(state, parentQuery) {
  const clean = String(parentQuery ?? '').trim()
  if (!clean || clean.toLowerCase() === 'current') {
    return getActivePage(state)?.id ?? null
  }
  if (clean.toLowerCase() === 'root') {
    return null
  }
  const match = resolvePageMatch(state, clean)
  if (!match) {
    throw new Error(`No parent canvas matched “${clean}”.`)
  }
  return match.id
}

export function resolvePageMatch(state, query) {
  const clean = String(query ?? '').trim()
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

function collectComponentAttributeKeys(shapes) {
  const keys = new Set()
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g
  for (const shapeObj of shapes) {
    const type = shapeObj?.shape?.type
    const textSources =
      type === 'TEXT'
        ? shapeObj.shape.lines ?? []
        : type === 'RECTANGLE'
          ? [shapeObj.shape.label ?? '', ...(shapeObj.shape.labelLines ?? [])]
          : type === 'LINE' || type === 'MULTI_SEGMENT_LINE'
            ? shapeObj.shape.labelLines ?? []
            : []
    for (const source of textSources) {
      for (const match of String(source ?? '').matchAll(pattern)) {
        if (match[1]) {
          keys.add(match[1])
        }
      }
    }
  }
  return [...keys]
}

function removeShapeIdsFromGroups(groups, shapeIds) {
  return groups
    .map((group) => ({
      ...group,
      shapeIds: group.shapeIds.filter((shapeId) => !shapeIds.has(shapeId)),
    }))
    .filter((group) => group.shapeIds.length > 1)
}

function getBoundingBox(shape) {
  switch (shape.type) {
    case 'RECTANGLE':
      return {
        top: shape.tl.r,
        bottom: shape.br.r,
        left: shape.tl.c,
        right: shape.br.c,
      }
    case 'LINE':
      return {
        top: Math.min(shape.start.r, shape.end.r),
        bottom: Math.max(shape.start.r, shape.end.r),
        left: Math.min(shape.start.c, shape.end.c),
        right: Math.max(shape.start.c, shape.end.c),
      }
    case 'MULTI_SEGMENT_LINE': {
      const points = [
        ...shape.segments.map((segment) => segment.start),
        ...shape.segments.map((segment) => segment.end),
      ]
      return {
        top: Math.min(...points.map((point) => point.r)),
        bottom: Math.max(...points.map((point) => point.r)),
        left: Math.min(...points.map((point) => point.c)),
        right: Math.max(...points.map((point) => point.c)),
      }
    }
    case 'TEXT': {
      const lines = Array.isArray(shape.lines) && shape.lines.length > 0 ? shape.lines : ['']
      return {
        top: shape.start.r,
        bottom: shape.start.r + lines.length - 1,
        left: shape.start.c,
        right: shape.start.c + Math.max(...lines.map((line) => String(line).length)) - 1,
      }
    }
    default:
      return null
  }
}

function getBoundingBoxOfAll(shapes) {
  if (!Array.isArray(shapes) || shapes.length === 0) return null
  const first = getBoundingBox(shapes[0])
  if (!first) return null
  const bounds = { ...first }
  for (const shape of shapes.slice(1)) {
    const next = getBoundingBox(shape)
    if (!next) continue
    bounds.top = Math.min(bounds.top, next.top)
    bounds.bottom = Math.max(bounds.bottom, next.bottom)
    bounds.left = Math.min(bounds.left, next.left)
    bounds.right = Math.max(bounds.right, next.right)
  }
  return bounds
}

function translatePoint(point, deltaRow, deltaCol) {
  return {
    ...point,
    r: point.r + deltaRow,
    c: point.c + deltaCol,
  }
}

function translateShape(shape, deltaRow, deltaCol) {
  switch (shape.type) {
    case 'RECTANGLE':
      return {
        ...shape,
        tl: translatePoint(shape.tl, deltaRow, deltaCol),
        br: translatePoint(shape.br, deltaRow, deltaCol),
      }
    case 'TEXT':
      return {
        ...shape,
        start: translatePoint(shape.start, deltaRow, deltaCol),
      }
    case 'LINE':
      return {
        ...shape,
        start: translatePoint(shape.start, deltaRow, deltaCol),
        end: translatePoint(shape.end, deltaRow, deltaCol),
      }
    case 'MULTI_SEGMENT_LINE':
      return {
        ...shape,
        segments: shape.segments.map((segment) => ({
          ...segment,
          start: translatePoint(segment.start, deltaRow, deltaCol),
          end: translatePoint(segment.end, deltaRow, deltaCol),
        })),
      }
    default:
      return shape
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * When a user says an attribute default is "Save", make the extracted component
 * source use {{label}} anywhere "Save" appeared so the first instance already
 * behaves like a component instead of a frozen copy.
 */
function applyAttributeTokensToText(input, attributes) {
  let nextValue = String(input ?? '')
  const sortedAttributes = [...attributes]
    .map((attribute) => ({
      key: String(attribute?.key ?? '').trim(),
      defaultValue: String(attribute?.defaultValue ?? ''),
    }))
    .filter((attribute) => attribute.key.length > 0 && attribute.defaultValue.length > 0)
    .sort((left, right) => right.defaultValue.length - left.defaultValue.length)

  for (const attribute of sortedAttributes) {
    const pattern = new RegExp(escapeRegExp(attribute.defaultValue), 'g')
    nextValue = nextValue.replace(pattern, `{{${attribute.key}}}`)
  }

  return nextValue
}

function applyAttributeTokensToShape(shape, attributes) {
  if (shape.type === 'TEXT') {
    return {
      ...shape,
      lines: (shape.lines ?? []).map((line) => applyAttributeTokensToText(line, attributes)),
    }
  }

  if (shape.type === 'RECTANGLE') {
    return {
      ...shape,
      label: shape.label ? applyAttributeTokensToText(shape.label, attributes) : shape.label,
      labelLines: (shape.labelLines ?? []).map((line) => applyAttributeTokensToText(line, attributes)),
    }
  }

  if (shape.type === 'LINE' || shape.type === 'MULTI_SEGMENT_LINE') {
    return {
      ...shape,
      labelLines: (shape.labelLines ?? []).map((line) => applyAttributeTokensToText(line, attributes)),
    }
  }

  return shape
}

function createComponentView(input) {
  const now = input.now ?? new Date().toISOString()
  return {
    id: createClientCanvasId(),
    canvasId: input.canvasId,
    label: input.label?.trim() || 'Component',
    viewType: 'component',
    rect: input.rect,
    color: input.color ?? COMPONENT_COLOR,
    componentProps: input.componentProps ?? {},
    target: {
      documentId: input.documentId ?? null,
      canvasId: input.sourceCanvasId,
      top: 0,
      left: 0,
    },
    createdAt: now,
    updatedAt: now,
  }
}

function extractSelectionToComponent(state, selectedObjectIds, name = null, explicitAttributes = []) {
  if (!Array.isArray(selectedObjectIds) || selectedObjectIds.length === 0) {
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
  const inferredAttributes = collectComponentAttributeKeys(selectedShapes).map((key) => ({
    key,
    defaultValue: '',
  }))
  const componentAttributeMap = new Map(
    inferredAttributes.map((attribute) => [attribute.key, attribute]),
  )
  for (const attribute of explicitAttributes) {
    const key = String(attribute?.key ?? '').trim()
    if (!key) continue
    componentAttributeMap.set(key, {
      key,
      defaultValue: String(attribute.defaultValue ?? ''),
    })
  }
  const componentAttributes = [...componentAttributeMap.values()]
  const normalizedShapes = selectedShapes.map((shapeObj) => ({
    ...shapeObj,
    shape: applyAttributeTokensToShape(
      translateShape(shapeObj.shape, -bounds.top, -bounds.left),
      componentAttributes,
    ),
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

  const nextComponentPage = {
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

  return {
    nextState: {
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
    },
    componentName,
    attributeCount: componentAttributes.length,
  }
}

export function parseStructureCanvasCommand(input) {
  const value = String(input ?? '').trim()
  const commandName = value.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const rest = value.slice(commandName.length).trim()
  const named = parseNamedStringArgs(rest)
  let match = null

  if (commandName === 'page.new' || commandName === 'diagram.new') {
    if ('name' in named || 'parent' in named) {
      const name = named.name?.trim() || null
      const parent = named.parent?.trim() || null
      return {
        definition: findDefinition('page.new'),
        syntaxStyle: 'canonical',
        canonicalInput: `page.new${name ? ` name=${quoteCommandValue(name)}` : ''}${parent ? ` parent=${quoteCommandValue(parent)}` : ''}`,
        command: { kind: 'page.new', name, parent },
      }
    }
    match = value.match(/^(?:page\.new|diagram\.new)(?:\s+(.+))?$/i)
    if (match) {
      const name = match[1] ? parseCommandText(match[1]).trim() : null
      return {
        definition: findDefinition('page.new'),
        syntaxStyle: 'legacy',
        canonicalInput: `page.new${name ? ` name=${quoteCommandValue(name)}` : ''}`,
        command: { kind: 'page.new', name, parent: null },
      }
    }
  }

  if (commandName === 'page.open' || commandName === 'diagram.switch') {
    if ('target' in named) {
      return {
        definition: findDefinition('page.open'),
        syntaxStyle: 'canonical',
        canonicalInput: `page.open target=${quoteCommandValue(named.target)}`,
        command: { kind: 'page.open', query: named.target },
      }
    }
    match = value.match(/^(?:page\.open|diagram\.switch)\s+(.+)$/i)
    if (match) {
      const query = parseCommandText(match[1]).trim()
      return {
        definition: findDefinition('page.open'),
        syntaxStyle: 'legacy',
        canonicalInput: `page.open target=${quoteCommandValue(query)}`,
        command: { kind: 'page.open', query },
      }
    }
  }

  if (commandName === 'page.list' || commandName === 'diagram.list') {
    return {
      definition: findDefinition('page.list'),
      syntaxStyle: commandName === 'page.list' ? 'canonical' : 'legacy',
      canonicalInput: 'page.list',
      command: { kind: 'page.list' },
    }
  }

  if (commandName === 'page.rename') {
    const target = named.target?.trim()
    const name = named.name?.trim()
    if (!target || !name) {
      throw new Error('Usage: page.rename target="Checkout flow" name="Checkout".')
    }
    return {
      definition: findDefinition('page.rename'),
      syntaxStyle: 'canonical',
      canonicalInput: `page.rename target=${quoteCommandValue(target)} name=${quoteCommandValue(name)}`,
      command: { kind: 'page.rename', query: target, name },
    }
  }

  if (commandName === 'page.duplicate') {
    const target = named.target?.trim() || null
    return {
      definition: findDefinition('page.duplicate'),
      syntaxStyle: target ? 'canonical' : 'legacy',
      canonicalInput: `page.duplicate${target ? ` target=${quoteCommandValue(target)}` : ''}`,
      command: { kind: 'page.duplicate', query: target },
    }
  }

  if (commandName === 'page.delete') {
    const target = named.target?.trim() || null
    return {
      definition: findDefinition('page.delete'),
      syntaxStyle: target ? 'canonical' : 'legacy',
      canonicalInput: `page.delete${target ? ` target=${quoteCommandValue(target)}` : ''}`,
      command: { kind: 'page.delete', query: target },
    }
  }

  if (commandName === 'group.create') {
    const objectIds = 'objects' in named ? parseObjectIdList(named.objects) : []
    return {
      definition: findDefinition('group.create'),
      syntaxStyle: 'objects' in named ? 'canonical' : rest.length === 0 ? 'canonical' : 'legacy',
      canonicalInput: `group.create${objectIds.length > 0 ? ` objects=${quoteCommandValue(objectIds.join(','))}` : ''}`,
      command: { kind: 'group.create', objectIds },
    }
  }

  if (commandName === 'group.break') {
    const objectIds = 'objects' in named ? parseObjectIdList(named.objects) : []
    return {
      definition: findDefinition('group.break'),
      syntaxStyle: 'objects' in named ? 'canonical' : rest.length === 0 ? 'canonical' : 'legacy',
      canonicalInput: `group.break${objectIds.length > 0 ? ` objects=${quoteCommandValue(objectIds.join(','))}` : ''}`,
      command: { kind: 'group.break', objectIds },
    }
  }

  if (commandName === 'component.mark') {
    return {
      definition: findDefinition('component.mark'),
      syntaxStyle: 'canonical',
      canonicalInput: 'component.mark',
      command: { kind: 'component.mark' },
    }
  }

  if (commandName === 'component.unmark') {
    return {
      definition: findDefinition('component.unmark'),
      syntaxStyle: 'canonical',
      canonicalInput: 'component.unmark',
      command: { kind: 'component.unmark' },
    }
  }

  if (commandName === 'component.create') {
    if ('name' in named || 'objects' in named || Object.keys(named).some((key) => key.startsWith('attr.'))) {
      const name = named.name?.trim() || null
      const objectIds = 'objects' in named ? parseObjectIdList(named.objects) : []
      return {
        definition: findDefinition('component.create'),
        syntaxStyle: 'canonical',
        canonicalInput: `component.create${name ? ` name=${quoteCommandValue(name)}` : ''}${Object.entries(named)
          .filter(([key]) => key === 'objects' || key.startsWith('attr.'))
          .map(([key, value]) => ` ${key}=${quoteCommandValue(value)}`)
          .join('')}`,
        command: {
          kind: 'component.create',
          name,
          objectIds,
          attributes: Object.entries(named)
            .filter(([key]) => key.startsWith('attr.'))
            .map(([key, value]) => ({
              key: key.slice('attr.'.length),
              defaultValue: value,
            })),
        },
      }
    }
    match = value.match(/^component\.create(?:\s+(.+))?$/i)
    if (match) {
      const name = match[1] ? parseCommandText(match[1]).trim() : null
      return {
        definition: findDefinition('component.create'),
        syntaxStyle: 'legacy',
        canonicalInput: `component.create${name ? ` name=${quoteCommandValue(name)}` : ''}`,
        command: { kind: 'component.create', name, objectIds: [], attributes: [] },
      }
    }
  }

  if (commandName === 'component.attr') {
    match = value.match(/^component\.attr\s+(add|remove)\b/i)
    if (match) {
      const mode = match[1]?.toLowerCase()
      if (mode === 'add') {
        const key = named.key ?? value.match(/^component\.attr\s+add\s+(\S+)/i)?.[1]
        if (!key) {
          throw new Error('Missing key.')
        }
        const defaultValue = named.default ?? named.value ?? ''
        return {
          definition: findDefinition('component.attr'),
          syntaxStyle: 'key' in named || 'default' in named || 'value' in named ? 'canonical' : 'legacy',
          canonicalInput: `component.attr add key=${key}${defaultValue ? ` default=${quoteCommandValue(defaultValue)}` : ''}`,
          command: { kind: 'component.attr.upsert', key, defaultValue },
        }
      }
      const key = named.key ?? value.match(/^component\.attr\s+remove\s+(\S+)/i)?.[1]
      if (!key) {
        throw new Error('Missing key.')
      }
      return {
        definition: findDefinition('component.attr'),
        syntaxStyle: 'key' in named ? 'canonical' : 'legacy',
        canonicalInput: `component.attr remove key=${key}`,
        command: { kind: 'component.attr.remove', key },
      }
    }
  }

  if (commandName === 'component.use') {
    if ('source' in named || 'top' in named || 'left' in named) {
      const source = named.source
      if (!source) {
        throw new Error('Missing source.')
      }
      const top = ensureNumber(named.top, 'top')
      const left = ensureNumber(named.left, 'left')
      const props = Object.fromEntries(
        Object.entries(named).filter(([key]) => !['source', 'top', 'left'].includes(key)),
      )
      const propSuffix = Object.entries(props)
        .map(([key, value]) => ` ${key}=${quoteCommandValue(value)}`)
        .join('')
      return {
        definition: findDefinition('component.use'),
        syntaxStyle: 'canonical',
        canonicalInput: `component.use source=${quoteCommandValue(source)} top=${top} left=${left}${propSuffix}`,
        command: { kind: 'component.use', query: source, top, left, props },
      }
    }
    match = value.match(/^component\.use\s+(\S+)\s+(-?\d+)\s+(-?\d+)(.*)$/i)
    if (match) {
      const query = parseCommandText(match[1]).trim()
      const top = Number(match[2])
      const left = Number(match[3])
      const props = parseNamedStringArgs(match[4] || '')
      const propSuffix = Object.entries(props)
        .map(([key, propValue]) => ` ${key}=${quoteCommandValue(propValue)}`)
        .join('')
      return {
        definition: findDefinition('component.use'),
        syntaxStyle: 'legacy',
        canonicalInput: `component.use source=${quoteCommandValue(query)} top=${top} left=${left}${propSuffix}`,
        command: { kind: 'component.use', query, top, left, props },
      }
    }
  }

  const exactCommand = findDefinition(commandName.startsWith('diagram.') ? commandName.replace(/^diagram\./, 'page.') : commandName)
  if (exactCommand) {
    throw new Error(`Usage: ${exactCommand.canonicalUsage}`)
  }

  throw new Error(`Unknown command. Try: ${CANVAS_STRUCTURE_COMMANDS.map((command) => command.name).join(', ')}.`)
}

export function buildStructureCanvasCommandPreview(input, state) {
  const value = String(input ?? '').trim()
  if (!value) return null

  const commandName = value.split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const rest = value.slice(commandName.length).trim()
  const named = parseNamedStringArgs(rest)
  const numbers = getLeadingNumbers(value)
  const activePage = getActivePage(state)

  if (commandName === 'page.new' || commandName === 'diagram.new') {
    const name = named.name?.trim() || (rest && !rest.includes('=') ? parseCommandText(rest).trim() : null)
    const parent = named.parent?.trim() || null
    const parentLabel =
      !parent || parent.toLowerCase() === 'current'
        ? `under “${activePage?.name ?? 'current canvas'}”`
        : parent.toLowerCase() === 'root'
          ? 'at the root level'
          : `under “${parent}”`
    return {
      kind: 'info',
      label: name
        ? `Will create canvas “${name}” ${parentLabel}.`
        : `Will create canvas “${createUniqueCanvasName(state.diagrams.map((diagram) => diagram.name))}” ${parentLabel}.`,
    }
  }

  if (commandName === 'page.open' || commandName === 'diagram.switch') {
    const query = named.target?.trim() || (rest && !rest.includes('=') ? parseCommandText(rest).trim() : null)
    if (!query) {
      return { kind: 'info', label: 'Type a page index, id, or name to preview navigation.' }
    }
    const match = resolvePageMatch(state, query)
    if (match) {
      return { kind: 'info', label: `Will open page “${match.name}”.` }
    }
    return { kind: 'info', label: `No page matched “${query}” yet.` }
  }

  if (commandName === 'page.rename') {
    const target = named.target?.trim() || null
    const name = named.name?.trim() || null
    if (!target) {
      return { kind: 'info', label: 'Type target="..." and name="..." to preview a rename.' }
    }
    const match = resolvePageMatch(state, target)
    if (!match) {
      return { kind: 'info', label: `No canvas matched “${target}”.` }
    }
    return {
      kind: 'info',
      label: name ? `Will rename “${match.name}” to “${name}”.` : `Set name="..." to rename “${match.name}”.`,
    }
  }

  if (commandName === 'page.duplicate') {
    const target = named.target?.trim() || activePage?.name || null
    if (!target) {
      return { kind: 'info', label: 'Choose a canvas to duplicate.' }
    }
    const match = resolvePageMatch(state, target)
    return {
      kind: 'info',
      label: match ? `Will duplicate “${match.name}”.` : `No canvas matched “${target}”.`,
    }
  }

  if (commandName === 'page.delete') {
    const target = named.target?.trim() || activePage?.name || null
    if (!target) {
      return { kind: 'info', label: 'Choose a canvas to delete.' }
    }
    const match = resolvePageMatch(state, target)
    if (!match) {
      return { kind: 'info', label: `No canvas matched “${target}”.` }
    }
    const descendants = getDescendantPages(state, match.id)
    return {
      kind: 'info',
      label:
        descendants.length > 0
          ? `Will delete “${match.name}” and ${descendants.length} nested canvas${descendants.length === 1 ? '' : 'es'}.`
          : `Will delete “${match.name}”.`,
    }
  }

  if (commandName === 'component.create') {
    const name = named.name?.trim() || (rest && !rest.includes('=') ? parseCommandText(rest).trim() : null)
    const objectCount = 'objects' in named ? parseObjectIdList(named.objects).length : 0
    const attributeEntries = Object.entries(named)
      .filter(([key]) => key.startsWith('attr.'))
      .map(([key, value]) => ({ key: key.slice('attr.'.length), defaultValue: value }))
    return {
      kind: 'info',
      label: name
        ? `Will extract ${objectCount > 0 ? `${objectCount} explicit object${objectCount === 1 ? '' : 's'}` : 'the current selection'} into component “${name}”${attributeEntries.length > 0 ? ` with ${attributeEntries.length} attribute${attributeEntries.length === 1 ? '' : 's'}` : ''}.`
        : `Will extract ${objectCount > 0 ? `${objectCount} explicit object${objectCount === 1 ? '' : 's'}` : 'the current selection'} into a new component${attributeEntries.length > 0 ? ` with ${attributeEntries.length} attribute${attributeEntries.length === 1 ? '' : 's'}` : ''}.`,
    }
  }

  if (commandName === 'component.attr') {
    return {
      kind: 'info',
      label: 'Component attributes change the props available to every instance of the current component.',
    }
  }

  if (commandName === 'component.use') {
    const source = named.source?.trim() || value.match(/^component\.use\s+(\S+)/i)?.[1] || null
    const top = named.top != null ? Number(named.top) : numbers[0]
    const left = named.left != null ? Number(named.left) : numbers[1]
    const sourcePage = source ? resolvePageMatch(state, source) : null
    if (sourcePage && Number.isFinite(top) && Number.isFinite(left)) {
      return {
        kind: 'rect',
        canvasId: activePage?.id ?? null,
        top,
        left,
        width: sourcePage.data.canvasSize.cols,
        height: sourcePage.data.canvasSize.rows,
        label: `Component “${sourcePage.name}” at (${top}, ${left})`,
      }
    }
    if (Number.isFinite(top)) {
      return {
        kind: 'point',
        canvasId: activePage?.id ?? null,
        row: top,
        col: Number.isFinite(left) ? left : 0,
        label: `Component anchor at (${top}, ${Number.isFinite(left) ? left : 0})`,
      }
    }
    return { kind: 'info', label: 'Type source, top, and left to preview the component instance.' }
  }

  return null
}

/**
 * Execute a parsed structure command against the current canvas state.
 *
 * The caller is responsible for persisting the returned next state. Keeping the
 * executor pure makes the browser terminal, MCP server, and future HTTP API use
 * the same semantics with different storage backends.
 */
export function executeStructureCanvasCommand(state, command, options = {}) {
  const selectedObjectIds = Array.isArray(options.selectedObjectIds) ? options.selectedObjectIds : []

  if (command.kind === 'page.new') {
    const name = command.name || createUniqueCanvasName(state.diagrams.map((diagram) => diagram.name))
    const nextPageId = createClientCanvasId()
    const parentCanvasId = resolvePageParentId(state, command.parent)
    const parentLabel =
      parentCanvasId == null
        ? 'the root level'
        : `“${state.diagrams.find((diagram) => diagram.id === parentCanvasId)?.name ?? 'current canvas'}”`
    return {
      nextState: {
        ...state,
        activeDiagramId: nextPageId,
        diagrams: [
          ...state.diagrams,
          {
            id: nextPageId,
            name,
            parentCanvasId,
            kind: 'page',
            sourceCanvasId: null,
            componentAttributes: [],
            data: initDiagramData(),
          },
        ],
      },
      message: `Created canvas “${name}” under ${parentLabel}.`,
    }
  }

  if (command.kind === 'page.open') {
    const match = resolvePageMatch(state, command.query)
    if (!match) {
      throw new Error(`No page matched “${command.query}”.`)
    }
    return {
      nextState: {
        ...state,
        activeDiagramId: match.id,
      },
      message: `Opened page “${match.name}”.`,
    }
  }

  if (command.kind === 'page.list') {
    return {
      nextState: state,
      message: state.diagrams
        .map((diagram, index) => `${index + 1}. ${diagram.name}${diagram.id === state.activeDiagramId ? ' (current)' : ''}`)
        .join(' · '),
    }
  }

  if (command.kind === 'page.rename') {
    const match = resolvePageMatch(state, command.query)
    if (!match) {
      throw new Error(`No canvas matched “${command.query}”.`)
    }
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === match.id
            ? {
                ...diagram,
                name: command.name,
              }
            : diagram,
        ),
      },
      message: `Renamed canvas to “${command.name}”.`,
    }
  }

  if (command.kind === 'page.duplicate') {
    const sourcePage = command.query ? resolvePageMatch(state, command.query) : getActivePage(state)
    if (!sourcePage) {
      throw new Error('No canvas matched the duplicate target.')
    }
    const duplicateId = createClientCanvasId()
    return {
      nextState: {
        ...state,
        activeDiagramId: duplicateId,
        diagrams: [
          ...state.diagrams,
          {
            ...cloneJsonValue(sourcePage),
            id: duplicateId,
            name: `${sourcePage.name} copy`,
          },
        ],
      },
      message: `Duplicated canvas “${sourcePage.name}”.`,
    }
  }

  if (command.kind === 'page.delete') {
    const targetPage = command.query ? resolvePageMatch(state, command.query) : getActivePage(state)
    if (!targetPage) {
      throw new Error('No canvas matched the delete target.')
    }
    const deleteIds = new Set([targetPage.id, ...getDescendantPages(state, targetPage.id).map((page) => page.id)])
    const remainingDiagrams = state.diagrams.filter((diagram) => !deleteIds.has(diagram.id))

    if (remainingDiagrams.length === 0) {
      const replacementId = createClientCanvasId()
      return {
        nextState: {
          ...state,
          activeDiagramId: replacementId,
          diagrams: [
            {
              id: replacementId,
              name: createUniqueCanvasName([]),
              parentCanvasId: null,
              kind: 'page',
              sourceCanvasId: null,
              componentAttributes: [],
              data: initDiagramData(),
            },
          ],
        },
        message: `Deleted canvas “${targetPage.name}”.`,
      }
    }

    const nextActive =
      remainingDiagrams.find((diagram) => diagram.id === state.activeDiagramId) ??
      remainingDiagrams.find((diagram) => diagram.id === targetPage.parentCanvasId) ??
      remainingDiagrams[0]

    return {
      nextState: {
        ...state,
        activeDiagramId: nextActive.id,
        diagrams: remainingDiagrams,
      },
      message: `Deleted canvas “${targetPage.name}”.`,
    }
  }

  if (command.kind === 'group.create') {
    const targetObjectIds = command.objectIds?.length > 0 ? command.objectIds : selectedObjectIds
    if (targetObjectIds.length < 2) {
      throw new Error('Select at least two objects before grouping.')
    }
    const activePage = getActivePage(state)
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === state.activeDiagramId
            ? {
                ...diagram,
                data: {
                  ...diagram.data,
                  groups: [
                    ...diagram.data.groups.filter(
                      (group) => !group.shapeIds.some((shapeId) => targetObjectIds.includes(shapeId)),
                    ),
                    {
                      id: createClientCanvasId(),
                      shapeIds: targetObjectIds,
                    },
                  ],
                },
              }
            : diagram,
        ),
      },
      message: `Grouped ${targetObjectIds.length} objects on “${activePage?.name ?? 'current page'}”.`,
    }
  }

  if (command.kind === 'group.break') {
    const targetObjectIds = command.objectIds?.length > 0 ? command.objectIds : selectedObjectIds
    if (targetObjectIds.length === 0) {
      throw new Error('Select a grouped object first.')
    }
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === state.activeDiagramId
            ? {
                ...diagram,
                data: {
                  ...diagram.data,
                  groups: diagram.data.groups.filter(
                    (group) => !group.shapeIds.some((shapeId) => targetObjectIds.includes(shapeId)),
                  ),
                },
              }
            : diagram,
        ),
      },
      message: targetObjectIds.length > 0 ? 'Removed grouping from the targeted objects.' : 'Removed grouping from the current selection.',
    }
  }

  if (command.kind === 'component.mark') {
    const activePage = getActivePage(state)
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === activePage.id
            ? {
                ...diagram,
                kind: 'component',
              }
            : diagram,
        ),
      },
      message: `Marked “${activePage.name}” as a component.`,
    }
  }

  if (command.kind === 'component.unmark') {
    const activePage = getActivePage(state)
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === activePage.id
            ? {
                ...diagram,
                kind: 'page',
              }
            : diagram,
        ),
      },
      message: `Returned “${activePage.name}” to a normal page.`,
    }
  }

  if (command.kind === 'component.create') {
    const targetObjectIds = command.objectIds?.length > 0 ? command.objectIds : selectedObjectIds
    const { nextState, componentName, attributeCount } = extractSelectionToComponent(
      state,
      targetObjectIds,
      command.name,
      command.attributes,
    )
    return {
      nextState,
      message:
        attributeCount > 0
          ? `Created component “${componentName}” with ${attributeCount} attribute${attributeCount === 1 ? '' : 's'}.`
          : `Created component “${componentName}”.`,
    }
  }

  if (command.kind === 'component.attr.upsert') {
    const activePage = getActivePage(state)
    if (activePage.kind !== 'component') {
      throw new Error('Open a component page before defining attributes.')
    }
    const existing = activePage.componentAttributes.find((attribute) => attribute.key === command.key)
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === activePage.id
            ? {
                ...diagram,
                componentAttributes: existing
                  ? diagram.componentAttributes.map((attribute) =>
                      attribute.key === command.key
                        ? { ...attribute, defaultValue: command.defaultValue }
                        : attribute,
                    )
                  : [...diagram.componentAttributes, { key: command.key, defaultValue: command.defaultValue }],
              }
            : diagram,
        ),
      },
      message: existing
        ? `Updated component attribute “${command.key}”.`
        : `Added component attribute “${command.key}”.`,
    }
  }

  if (command.kind === 'component.attr.remove') {
    const activePage = getActivePage(state)
    if (activePage.kind !== 'component') {
      throw new Error('Open a component page before removing attributes.')
    }
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === activePage.id
            ? {
                ...diagram,
                componentAttributes: diagram.componentAttributes.filter((attribute) => attribute.key !== command.key),
              }
            : diagram,
        ),
      },
      message: `Removed component attribute “${command.key}”.`,
    }
  }

  if (command.kind === 'component.use') {
    const sourcePage = resolvePageMatch(state, command.query)
    if (!sourcePage) {
      throw new Error(`No component page matched “${command.query}”.`)
    }
    if (sourcePage.id === state.activeDiagramId) {
      throw new Error('Use a component from another page, not the current page itself.')
    }
    if (sourcePage.kind !== 'component') {
      throw new Error(`“${sourcePage.name}” is not marked as a component yet.`)
    }
    return {
      nextState: {
        ...state,
        diagrams: state.diagrams.map((diagram) =>
          diagram.id === state.activeDiagramId
            ? {
                ...diagram,
                data: {
                  ...diagram.data,
                  portalViews: [
                    ...diagram.data.portalViews,
                    createComponentView({
                      canvasId: diagram.id,
                      sourceCanvasId: sourcePage.id,
                      label: sourcePage.name,
                      rect: {
                        top: command.top,
                        left: command.left,
                        width: sourcePage.data.canvasSize.cols,
                        height: sourcePage.data.canvasSize.rows,
                      },
                      componentProps: {
                        ...Object.fromEntries(
                          sourcePage.componentAttributes
                            .filter((attribute) => attribute.defaultValue.length > 0)
                            .map((attribute) => [attribute.key, attribute.defaultValue]),
                        ),
                        ...command.props,
                      },
                    }),
                  ],
                },
              }
            : diagram,
        ),
      },
      message: `Inserted component “${sourcePage.name}”.`,
    }
  }

  return {
    nextState: state,
    message: 'No-op.',
  }
}
