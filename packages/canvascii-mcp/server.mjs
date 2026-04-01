import { CanvasciiAgentClient } from '@canvascii/agent-client'
import {
  buildLiveCanvasCommandPreview,
  executeLiveCanvasCommand,
  getLiveCanvasCommandHelp,
  parseLiveCanvasCommand,
} from '@canvascii/agent-client/command-language'
import {
  buildStructureCanvasCommandPreview,
  executeStructureCanvasCommand,
  getStructureCanvasCommandHelp,
  parseStructureCanvasCommand,
} from '@canvascii/agent-client/structure-command-language'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const DEFAULT_BASE_URL = process.env.CANVASCII_BASE_URL || 'http://127.0.0.1:5001'
const rectangleStyleSchema = z.object({
  lineStyle: z.enum(['ASCII', 'LIGHT', 'LIGHT_ROUNDED', 'HEAVY', 'DOUBLE']).optional(),
  rectangleFill: z.enum(['NONE', 'SOLID']).optional(),
  rectangleBorder: z.enum(['AUTO', 'NONE', 'LINE', 'BLOCK']).optional(),
  rectangleTextAlignH: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional(),
  rectangleTextAlignV: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional(),
  rectangleTextWrap: z.enum(['OFF', 'WORD']).optional(),
  rectangleTextOverflow: z.enum(['HIDE', 'TRUNCATE']).optional(),
  rectangleTextPadding: z.number().int().min(0).max(8).optional(),
}).optional()
const genericStyleSchema = z.object({}).passthrough().optional()
const liveObjectTypeSchema = z.enum(['text', 'rectangle', 'line', 'polyline', 'path'])
const liveObjectSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    id: z.string().optional(),
    row: z.number().int(),
    col: z.number().int(),
    text: z.string().optional(),
    lines: z.array(z.string()).optional(),
    style: genericStyleSchema,
    zIndex: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('rectangle'),
    id: z.string().optional(),
    top: z.number().int(),
    left: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    label: z.string().optional(),
    body: z.string().optional(),
    bodyLines: z.array(z.string()).optional(),
    labelLines: z.array(z.string()).optional(),
    stylePreset: z.enum(['wireframe']).optional(),
    style: rectangleStyleSchema,
    zIndex: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('line'),
    id: z.string().optional(),
    from: z.object({ row: z.number().int(), col: z.number().int() }),
    to: z.object({ row: z.number().int(), col: z.number().int() }),
    labelLines: z.array(z.string()).optional(),
    style: genericStyleSchema,
    zIndex: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('path'),
    id: z.string().optional(),
    points: z.array(
      z.object({
        row: z.number().int(),
        col: z.number().int(),
      }),
    ).min(2),
    labelLines: z.array(z.string()).optional(),
    style: genericStyleSchema,
    zIndex: z.number().int().optional(),
  }),
])

const liveCommandSelectionSchema = {
  selectionActorId: z.string().optional(),
  selectionSessionId: z.string().optional(),
  selectionName: z.string().optional(),
}

function parseShareUrl(shareUrl) {
  const url = new URL(shareUrl)
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    canvasId: url.searchParams.get('canvas')?.trim() || null,
    shareToken: url.searchParams.get('share')?.trim() || null,
  }
}

function deriveCollabUrl(baseUrl) {
  const parsed = new URL(baseUrl)
  const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  const hostname = parsed.hostname
  const port = parsed.port === '5001' ? '5002' : parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return `${protocol}//${hostname}:${port}`
}

function normalizeRenderMode(mode) {
  const normalized = trimOrNull(mode)?.toUpperCase()
  if (!normalized) return undefined
  if (normalized === 'ASCII') return 'ASCII'
  if (normalized === 'UNICODE' || normalized === 'FULL') return 'UNICODE'
  throw new Error(`Unsupported render mode "${mode}". Use ASCII, UNICODE, or FULL.`)
}

function normalizeTargetInput(input = {}) {
  const targetValue = trimOrNull(input.target)
  const shareUrl = trimOrNull(input.shareUrl) || targetValue
  const fromUrl =
    shareUrl && /^https?:\/\//i.test(shareUrl)
      ? parseShareUrl(shareUrl)
      : null

  return {
    baseUrl: trimOrNull(input.baseUrl) || fromUrl?.baseUrl || currentTarget.baseUrl || DEFAULT_BASE_URL,
    canvasId:
      trimOrNull(input.canvasId) ||
      (!fromUrl && targetValue && !/^https?:\/\//i.test(targetValue) ? targetValue : null) ||
      fromUrl?.canvasId ||
      currentTarget.canvasId,
    shareToken: trimOrNull(input.shareToken) || fromUrl?.shareToken || currentTarget.shareToken,
    sessionCookie: trimOrNull(input.sessionCookie) || currentTarget.sessionCookie,
  }
}

function trimOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRectangleBodyInput(input = {}) {
  if (Array.isArray(input.bodyLines)) return [...input.bodyLines]
  if (typeof input.body === 'string') return input.body.split('\n')
  if (Array.isArray(input.labelLines)) return [...input.labelLines]
  return undefined
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeTargetFromEnv() {
  const shareUrl = trimOrNull(process.env.CANVASCII_SHARE_URL)
  if (shareUrl) {
    const parsed = parseShareUrl(shareUrl)
    return {
      baseUrl: parsed.baseUrl,
      canvasId: parsed.canvasId,
      shareToken: parsed.shareToken,
      sessionCookie: trimOrNull(process.env.CANVASCII_SESSION_COOKIE),
    }
  }

  return {
    baseUrl: DEFAULT_BASE_URL,
    canvasId: trimOrNull(process.env.CANVASCII_CANVAS_ID),
    shareToken: trimOrNull(process.env.CANVASCII_SHARE_TOKEN),
    sessionCookie: trimOrNull(process.env.CANVASCII_SESSION_COOKIE),
  }
}

let currentTarget = makeTargetFromEnv()
let liveClient = null

function mergeTarget(input = {}) {
  return normalizeTargetInput(input)
}

function sameTarget(left, right) {
  return (
    (left?.baseUrl || '') === (right?.baseUrl || '') &&
    (left?.canvasId || '') === (right?.canvasId || '') &&
    (left?.shareToken || '') === (right?.shareToken || '') &&
    (left?.sessionCookie || '') === (right?.sessionCookie || '')
  )
}

function requireCanvasId(target) {
  if (!target.canvasId) {
    throw new Error(
      'No canvas target configured. Call configure_canvascii_target first, or set CANVASCII_SHARE_URL / CANVASCII_CANVAS_ID.',
    )
  }
}

function makeHeaders(target, contentType = false) {
  const headers = {}
  if (contentType) headers['content-type'] = 'application/json'
  if (target.shareToken) headers['x-canvascii-share-token'] = target.shareToken
  if (target.sessionCookie) headers.cookie = target.sessionCookie
  return headers
}

async function requestJson(url, init = {}, context = {}) {
  const response = await fetch(url, init)
  const json = await response.json().catch(() => null)
  if (!response.ok || !json?.success) {
    if (response.status === 404 && context.target?.canvasId) {
      const authHint =
        context.target?.shareToken || context.target?.sessionCookie
          ? 'The canvas may not exist, or this principal cannot read it.'
          : 'This usually means the canvas is not public and you did not provide a share token or session cookie.'
      throw new Error(`Canvas ${context.target.canvasId} could not be resolved. ${authHint}`)
    }
    if ((response.status === 401 || response.status === 403) && context.target?.canvasId) {
      throw new Error(
        `Access denied for canvas ${context.target.canvasId}. Provide a share URL, share token, or authenticated session cookie.`,
      )
    }
    throw new Error(json?.error?.message || `Request failed with status ${response.status}.`)
  }
  return json.data
}

async function disconnectLiveClient() {
  if (!liveClient) return
  try {
    liveClient.disconnect()
  } finally {
    liveClient = null
  }
}

function isLiveClientUsable(client) {
  if (!client) return false
  try {
    client.getDocument()
    return true
  } catch {
    return false
  }
}

function sameLiveConnectionConfig(client, input = {}) {
  const requestedCollabUrl = trimOrNull(input.collabUrl)
  if (!requestedCollabUrl) return true
  return trimOrNull(client?.collabUrl) === requestedCollabUrl
}

function summarizeShape(shapeObject) {
  const { id, shape } = shapeObject

  switch (shape.type) {
    case 'RECTANGLE':
      return {
        id,
        type: shape.type,
        topLeft: shape.tl,
        bottomRight: shape.br,
        label: shape.label || null,
        body: shape.labelLines?.filter(Boolean).join(' / ') || null,
      }
    case 'TEXT':
      return {
        id,
        type: shape.type,
        start: shape.start,
        text: shape.lines?.join(' / ') || '',
      }
    case 'LINE':
      return {
        id,
        type: shape.type,
        start: shape.start,
        end: shape.end,
      }
    case 'MULTI_SEGMENT_LINE':
      return {
        id,
        type: shape.type,
        segments: shape.segments?.length || 0,
        label: shape.labelLines?.filter(Boolean).join(' / ') || null,
      }
    default:
      return {
        id,
        type: shape.type,
      }
  }
}

function summarizeCanvas(detail, options = {}) {
  const editorState = detail.editorState || {}
  const diagrams = Array.isArray(editorState.diagrams) ? editorState.diagrams : []
  const activeDiagramId = editorState.activeDiagramId || diagrams[0]?.id || null
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId) || diagrams[0] || null
  const shapes = Array.isArray(activeDiagram?.data?.shapes) ? activeDiagram.data.shapes : []
  const shapeLimit = Number.isFinite(options.shapeLimit) ? options.shapeLimit : 25
  const shapeCounts = {}

  for (const shapeObject of shapes) {
    const type = shapeObject?.shape?.type || 'UNKNOWN'
    shapeCounts[type] = (shapeCounts[type] || 0) + 1
  }

  return {
    id: detail.id,
    title: detail.title,
    storageKey: detail.storageKey,
    revision: detail.revision,
    updatedAt: detail.updatedAt,
    etag: detail.etag,
    accessSummary: detail.accessSummary,
    activeDiagramId,
    portals: (detail.sharePolicy?.portals || []).map((portal) => ({
      id: portal.id,
      label: portal.label,
      rect: portal.rect,
      color: portal.color,
      access:
        detail.accessSummary?.portals?.find((entry) => entry.id === portal.id)?.access || detail.accessSummary?.rootAccess || 'none',
    })),
    activeDiagram: activeDiagram
      ? {
          id: activeDiagram.id,
          name: activeDiagram.name,
          canvasSize: activeDiagram.data?.canvasSize || null,
          shapeCounts,
          shapes: shapes.slice(0, shapeLimit).map(summarizeShape),
          truncated: shapes.length > shapeLimit,
        }
      : null,
    editorState: options.includeEditorState ? editorState : undefined,
    sharePolicy: options.includeSharePolicy ? detail.sharePolicy : undefined,
  }
}

function summarizeCanvasStructure(detail) {
  const editorState = detail.editorState || {}
  const diagrams = Array.isArray(editorState.diagrams) ? editorState.diagrams : []
  return {
    activePageId: editorState.activeDiagramId || diagrams[0]?.id || null,
    pages: diagrams.map((diagram, index) => ({
      index: index + 1,
      id: diagram.id,
      name: diagram.name,
      kind: diagram.kind || 'page',
      parentCanvasId: diagram.parentCanvasId ?? null,
      sourceCanvasId: diagram.sourceCanvasId ?? null,
      componentAttributes: Array.isArray(diagram.componentAttributes)
        ? diagram.componentAttributes.map((attribute) => ({
            key: attribute.key,
            defaultValue: attribute.defaultValue,
          }))
        : [],
      canvasSize: diagram.data?.canvasSize || null,
    })),
  }
}

async function getCanvasDetail(target) {
  requireCanvasId(target)
  const url = new URL('/api/v1/canvascii/canvas', target.baseUrl)
  url.searchParams.set('id', target.canvasId)
  if (target.shareToken) {
    url.searchParams.set('share', target.shareToken)
  }

  return requestJson(url, {
    headers: makeHeaders(target),
  }, { target, operation: 'getCanvasDetail' })
}

async function putCanvasEditorState(target, detail, editorState) {
  requireCanvasId(target)
  const url = new URL('/api/v1/canvascii/canvas', target.baseUrl)
  if (target.shareToken) {
    url.searchParams.set('share', target.shareToken)
  }

  return requestJson(url, {
    method: 'PUT',
    headers: makeHeaders(target, true),
    body: JSON.stringify({
      id: target.canvasId,
      editorState,
      ifMatchEtag: detail.etag,
    }),
  }, { target, operation: 'putCanvasEditorState' })
}

async function getCollabAccess(target) {
  requireCanvasId(target)
  const url = new URL('/api/v1/canvascii/collab-access', target.baseUrl)
  url.searchParams.set('id', target.canvasId)
  if (target.shareToken) {
    url.searchParams.set('share', target.shareToken)
  }

  return requestJson(url, {
    headers: makeHeaders(target),
  }, { target, operation: 'getCollabAccess' })
}

async function applyAgentAction(target, action) {
  requireCanvasId(target)
  const url = new URL('/api/v1/canvascii/agent', target.baseUrl)
  if (target.shareToken) {
    url.searchParams.set('share', target.shareToken)
  }

  return requestJson(url, {
    method: 'POST',
    headers: makeHeaders(target, true),
    body: JSON.stringify({
      id: target.canvasId,
      action,
    }),
  }, { target, operation: 'applyAgentAction' })
}

async function ensureLiveClient(target, input = {}) {
  requireCanvasId(target)
  if (liveClient && sameTarget(liveClient.__target, target)) {
    if (sameLiveConnectionConfig(liveClient, input) && isLiveClientUsable(liveClient)) {
      return liveClient
    }
    await disconnectLiveClient()
  }

  await disconnectLiveClient()

  liveClient = new CanvasciiAgentClient({
    baseUrl: target.baseUrl,
    collabUrl: trimOrNull(input.collabUrl) || deriveCollabUrl(target.baseUrl) || process.env.CANVASCII_COLLAB_URL,
    canvasId: target.canvasId,
    shareToken: target.shareToken,
    sessionCookie: target.sessionCookie,
    name: trimOrNull(input.name) || 'Canvascii MCP Agent',
    color: trimOrNull(input.color) || '#f97316',
    ...(trimOrNull(input.actorId) ? { actorId: trimOrNull(input.actorId) } : {}),
    activeTool: trimOrNull(input.activeTool) || null,
  })
  liveClient.__target = { ...target }
  try {
    await liveClient.connect()
    if (!isLiveClientUsable(liveClient)) {
      throw new Error('Live canvas connection did not load a room document.')
    }
    return liveClient
  } catch (error) {
    await disconnectLiveClient()
    throw error
  }
}

function resolveStructureSelection(client, input = {}) {
  const canvasId = input.canvasId || client.getDocument().activeCanvasId
  const explicit = client.getCollaboratorSelection({
    actorId: input.selectionActorId,
    sessionId: input.selectionSessionId,
    name: input.selectionName,
    canvasId,
  })

  if (explicit?.selection?.objectIds?.length) {
    return explicit.selection.objectIds
  }

  const candidates = client
    .listCollaborators({ canvasId })
    .filter((collaborator) => Array.isArray(collaborator.selection?.objectIds) && collaborator.selection.objectIds.length > 0)

  if (candidates.length === 0) {
    return []
  }

  if (candidates.length > 1) {
    throw new Error(
      'Structure command selection is ambiguous because multiple collaborators have selections. Pass selectionActorId/sessionId/name.',
    )
  }

  return candidates[0].selection.objectIds
}

function getActiveDiagram(detail) {
  const editorState = detail.editorState || {}
  const diagrams = Array.isArray(editorState.diagrams) ? editorState.diagrams : []
  const activeDiagramId = editorState.activeDiagramId || diagrams[0]?.id || null
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId) || diagrams[0] || null

  if (!activeDiagram || !activeDiagram?.data || !Array.isArray(activeDiagram.data.shapes)) {
    throw new Error('Active diagram is missing or malformed.')
  }

  return {
    editorState,
    diagrams,
    activeDiagramId: activeDiagram.id,
    activeDiagram,
    shapes: activeDiagram.data.shapes,
  }
}

function findTextShape(detail, input = {}) {
  const { shapes } = getActiveDiagram(detail)

  if (input.shapeId) {
    const byId = shapes.find((shapeObject) => shapeObject?.id === input.shapeId && shapeObject?.shape?.type === 'TEXT') || null
    if (byId) return byId
  }

  if (Number.isInteger(input.row) && Number.isInteger(input.col)) {
    return (
      shapes.find(
        (shapeObject) =>
          shapeObject?.shape?.type === 'TEXT' &&
          shapeObject?.shape?.start?.r === input.row &&
          shapeObject?.shape?.start?.c === input.col,
      ) || null
    )
  }

  return null
}

function replaceTextShapeLines(editorState, activeDiagramId, shapeId, lines) {
  return {
    ...editorState,
    diagrams: editorState.diagrams.map((diagram) => {
      if (diagram.id !== activeDiagramId) return diagram

      return {
        ...diagram,
        data: {
          ...diagram.data,
          shapes: diagram.data.shapes.map((shapeObject) =>
            shapeObject.id === shapeId
              ? {
                  ...shapeObject,
                  shape: {
                    ...shapeObject.shape,
                    lines,
                  },
                }
              : shapeObject,
          ),
        },
      }
    }),
  }
}

function splitTextToLines(text) {
  return String(text).split('\n')
}

function splitStreamChunks(text, chunkMode) {
  if (chunkMode === 'word') {
    const chunks = String(text).match(/\S+\s*|\s+/g)
    return chunks?.length ? chunks : [String(text)]
  }

  return Array.from(String(text))
}

async function ensureTextShape(target, input = {}) {
  if (input.shapeId || (Number.isInteger(input.row) && Number.isInteger(input.col))) {
    const detail = await getCanvasDetail(target)
    const existing = findTextShape(detail, input)
    if (existing) {
      return { detail, shape: existing, created: false }
    }
  }

  if (!input.createIfMissing) {
    throw new Error('Text shape not found. Pass shapeId, or row + col, or set createIfMissing.')
  }

  if (!Number.isInteger(input.row) || !Number.isInteger(input.col)) {
    throw new Error('row and col are required when createIfMissing is true.')
  }

  await applyAgentAction(target, {
    type: 'create_text',
    row: input.row,
    col: input.col,
    lines: input.initialLines?.length ? input.initialLines : [''],
  })

  const detail = await getCanvasDetail(target)
  const created = findTextShape(detail, {
    row: input.row,
    col: input.col,
  })

  if (!created) {
    throw new Error('Text shape was created but could not be resolved afterward.')
  }

  return { detail, shape: created, created: true }
}

async function updateTextShape(target, input = {}) {
  const { detail, shape, created } = await ensureTextShape(target, input)
  const { editorState, activeDiagramId } = getActiveDiagram(detail)
  const lines = input.lines?.length ? input.lines : splitTextToLines(input.text ?? '')
  const nextEditorState = replaceTextShapeLines(editorState, activeDiagramId, shape.id, lines)
  const nextDetail = await putCanvasEditorState(target, detail, nextEditorState)

  return {
    detail: nextDetail,
    shapeId: shape.id,
    created,
    lines,
  }
}

async function streamTextShape(target, input = {}) {
  const tokenDelayMs = Number.isInteger(input.tokenDelayMs) ? input.tokenDelayMs : 80
  const chunkMode = input.chunkMode === 'word' ? 'word' : 'char'
  const sourceText = input.text ?? ''
  const chunks = splitStreamChunks(sourceText, chunkMode)
  const prefix = input.prefix ?? ''
  let currentText = input.clearFirst ? '' : prefix
  let detail = null
  let shapeId = trimOrNull(input.shapeId)
  let created = false

  if (sourceText.length === 0) {
    const updated = await updateTextShape(target, {
      ...input,
      shapeId,
      text: currentText,
      createIfMissing: input.createIfMissing,
    })

    return {
      detail: updated.detail,
      shapeId: updated.shapeId,
      created: updated.created,
      chunksApplied: 0,
      text: currentText,
      lines: updated.lines,
    }
  }

  for (let index = 0; index < chunks.length; index += 1) {
    currentText += chunks[index]
    const updated = await updateTextShape(target, {
      ...input,
      shapeId,
      text: currentText,
      createIfMissing: input.createIfMissing ?? index === 0,
    })
    detail = updated.detail
    shapeId = updated.shapeId
    created = created || updated.created

    if (index < chunks.length - 1 && tokenDelayMs > 0) {
      await sleep(tokenDelayMs)
    }
  }

  return {
    detail,
    shapeId,
    created,
    chunksApplied: chunks.length,
    text: currentText,
    lines: splitTextToLines(currentText),
  }
}

function asToolResult(data) {
  const structuredContent =
    Array.isArray(data)
      ? {
          items: data,
        }
      : data
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent,
  }
}

function asToolError(error) {
  return {
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  }
}

function liveSnapshot(client, input = {}) {
  return client.getCanvasSnapshot({
    canvasId: input.canvasId,
    maxRows: input.maxRows ?? 80,
    maxCols: input.maxCols ?? 200,
    ...(normalizeRenderMode(input.mode) ? { mode: normalizeRenderMode(input.mode) } : {}),
  })
}

export function buildServer() {
  const server = new McpServer({
    name: 'canvascii',
    version: '0.1.0',
  })

  server.registerTool(
    'get_canvas_agent_capabilities',
    {
      title: 'Get Canvas Agent Capabilities',
      description:
        'Summarize the recommended tool families and explain how to handle stale MCP manifests when a client does not show newly added Canvascii tools.',
      inputSchema: {},
    },
    async () =>
      asToolResult({
        notes: [
          'If your client does not show a documented Canvascii MCP tool, restart the session or subprocess. Some MCP clients do not hot-load newly registered tools.',
          'Prefer the bulk region workflow for mockups: get_live_canvas_region_snapshot -> apply_canvas_json_live or upsert_objects_live.',
          'run_canvas_command_live now covers shared canvas verbs too, including canvas.read, canvas.apply, canvas.resize, canvas.expand, canvas.shrink, objects.move, objects.find, object.update, objects.replace, stack.pack, and objects.align.',
        ],
        target: currentTarget,
        coreReadTools: [
          'configure_canvascii_target',
          'connect_live_canvas',
          'get_live_canvas_snapshot',
          'get_live_canvas_region_snapshot',
          'get_canvas_rendered_text',
          'list_live_objects',
          'find_live_objects',
        ],
        coreWriteTools: [
          'apply_canvas_json_live',
          'upsert_objects_live',
          'move_objects_live',
          'replace_region_live',
          'clear_region_live',
          'run_canvas_command_live',
          'run_canvas_structure_command',
        ],
      }),
  )

  server.registerTool(
    'get_canvas_command_help',
    {
      title: 'Get Canvas Command Help',
      description:
        'List the canonical live command verbs that power both the human terminal and the agent command runner.',
      inputSchema: {
        query: z.string().optional(),
      },
    },
    async ({ query }) => {
      try {
        const commands = getLiveCanvasCommandHelp(query ?? '')
        return asToolResult({
          commands,
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'preview_canvas_command_live',
    {
      title: 'Preview Canvas Command Live',
      description:
        'Parse a canonical or legacy canvas command and return normalized syntax plus a spatial preview before mutating.',
      inputSchema: {
        command: z.string(),
        canvasId: z.string().optional(),
      },
    },
    async ({ command, canvasId }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        let parsed = null
        let parseError = null
        try {
          parsed = parseLiveCanvasCommand(command)
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error)
        }
        return asToolResult({
          ...(parsed
            ? {
                command: parsed.command.type,
                syntaxStyle: parsed.syntaxStyle,
                canonicalInput: parsed.canonicalInput,
                description: parsed.definition?.description ?? null,
              }
            : {}),
          ...(parseError ? { parseError } : {}),
          preview: buildLiveCanvasCommandPreview(command, {
            canvasId: canvasId || client.getDocument().activeCanvasId,
            document: client.getDocument(),
          }),
          help: getLiveCanvasCommandHelp(command),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'run_canvas_command_live',
    {
      title: 'Run Canvas Command Live',
      description:
        'Execute the canonical live command language directly against the collaboration room. Prefer this when you want the same surgical verbs as the human terminal.',
      inputSchema: {
        command: z.string(),
        canvasId: z.string().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
        ...liveCommandSelectionSchema,
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const parsed = parseLiveCanvasCommand(input.command)
        const result = await executeLiveCanvasCommand(client, parsed, input)
        return asToolResult(result)
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_canvas_structure_command_help',
    {
      title: 'Get Canvas Structure Command Help',
      description:
        'List the canonical page, component, and group commands that power both the human terminal and agent structure runner.',
      inputSchema: {
        query: z.string().optional(),
      },
    },
    async ({ query }) => {
      try {
        return asToolResult({
          commands: getStructureCanvasCommandHelp(query ?? ''),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'preview_canvas_structure_command',
    {
      title: 'Preview Canvas Structure Command',
      description:
        'Parse a canonical or legacy structure command and return normalized syntax plus a page/component/group preview before mutating.',
      inputSchema: {
        command: z.string(),
      },
    },
    async ({ command }) => {
      try {
        const detail = await getCanvasDetail(currentTarget)
        let parsed = null
        let parseError = null
        try {
          parsed = parseStructureCanvasCommand(command)
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error)
        }
        return asToolResult({
          ...(parsed
            ? {
                command: parsed.command.kind,
                syntaxStyle: parsed.syntaxStyle,
                canonicalInput: parsed.canonicalInput,
                description: parsed.definition?.description ?? null,
              }
            : {}),
          ...(parseError ? { parseError } : {}),
          preview: buildStructureCanvasCommandPreview(command, detail.editorState),
          help: getStructureCanvasCommandHelp(command),
          structure: summarizeCanvasStructure(detail),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'run_canvas_structure_command',
    {
      title: 'Run Canvas Structure Command',
      description:
        'Execute the canonical canvas-structure command language against the current canvas. This is the page/component/group counterpart to the live object command runner.',
      inputSchema: {
        command: z.string(),
        expectedRevision: z.number().int().nonnegative().optional(),
        ...liveCommandSelectionSchema,
      },
    },
    async (input) => {
      try {
        const detail = await getCanvasDetail(currentTarget)
        if (
          Number.isInteger(input.expectedRevision) &&
          detail.revision !== input.expectedRevision
        ) {
          throw new Error(
            `Canvas revision changed from ${input.expectedRevision} to ${detail.revision}. Re-read before mutating.`,
          )
        }

        const parsed = parseStructureCanvasCommand(input.command)
        const hasExplicitObjectIds = Array.isArray(parsed.command.objectIds) && parsed.command.objectIds.length > 0
        const needsSelection =
          !hasExplicitObjectIds &&
          (parsed.command.kind === 'group.create' ||
            parsed.command.kind === 'group.break' ||
            parsed.command.kind === 'component.create')

        const selectedObjectIds = needsSelection
          ? resolveStructureSelection(await ensureLiveClient(currentTarget), input)
          : []

        const result = executeStructureCanvasCommand(detail.editorState, parsed.command, {
          selectedObjectIds,
        })
        const nextDetail = await putCanvasEditorState(currentTarget, detail, result.nextState)

        return asToolResult({
          command: parsed.command.kind,
          syntaxStyle: parsed.syntaxStyle,
          canonicalInput: parsed.canonicalInput,
          description: parsed.definition?.description ?? null,
          message: result.message,
          selection: selectedObjectIds,
          structure: summarizeCanvasStructure(nextDetail),
          canvas: summarizeCanvas(nextDetail),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'configure_canvascii_target',
    {
      title: 'Configure Canvas Target',
      description:
        'Set the default Canvascii target from a share URL, canvas id + token, or a session cookie. Call this once at the start of a task.',
      inputSchema: {
        target: z.string().optional(),
        shareUrl: z.string().optional(),
        baseUrl: z.string().url().optional(),
        canvasId: z.string().optional(),
        shareToken: z.string().optional(),
        sessionCookie: z.string().optional(),
      },
    },
    async (input) => {
      try {
        currentTarget = mergeTarget(input)
        await disconnectLiveClient()
        const detail = await getCanvasDetail(currentTarget)
        const access = await getCollabAccess(currentTarget)

        return asToolResult({
          target: currentTarget,
          canvas: summarizeCanvas(detail),
          collabAccess: access,
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_canvas_overview',
    {
      title: 'Get Canvas Overview',
      description:
        'Read the current canvas and return an LLM-friendly summary: access, portals, active diagram, shape counts, and a sample of shapes.',
      inputSchema: {
        includeEditorState: z.boolean().optional(),
        includeSharePolicy: z.boolean().optional(),
        shapeLimit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (input) => {
      try {
        const detail = await getCanvasDetail(currentTarget)
        return asToolResult(summarizeCanvas(detail, input))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'connect_live_canvas',
    {
      title: 'Connect Live Canvas',
      description:
        'Join the live collaboration room as an agent collaborator so you can publish a cursor, read the rendered canvas, and apply live primitive edits.',
      inputSchema: {
        collabUrl: z.string().url().optional(),
        name: z.string().optional(),
        color: z.string().optional(),
        actorId: z.string().optional(),
        activeTool: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(currentTarget, input)
        return asToolResult({
          connected: true,
          target: currentTarget,
          documentId: client.documentId ?? null,
          rendered: client.getRenderedText({
            maxRows: 80,
            maxCols: 200,
          }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'disconnect_live_canvas',
    {
      title: 'Disconnect Live Canvas',
      description: 'Leave the current live collaboration room.',
      inputSchema: {},
    },
    async () => {
      try {
        await disconnectLiveClient()
        return asToolResult({
          connected: false,
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_canvas_rendered_text',
    {
      title: 'Get Canvas Rendered Text',
      description:
        'Render the current canvas into plain text from the live room so an agent can understand visible content directly.',
      inputSchema: {
        canvasId: z.string().optional(),
        startRow: z.number().int().min(0).optional(),
        startCol: z.number().int().min(0).optional(),
        maxRows: z.number().int().min(1).max(400).optional(),
        maxCols: z.number().int().min(1).max(400).optional(),
        trim: z.boolean().optional(),
        padding: z.number().int().min(0).max(20).optional(),
        mode: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        return asToolResult(
          client.getRenderedText({
            ...input,
            ...(normalizeRenderMode(input.mode) ? { mode: normalizeRenderMode(input.mode) } : {}),
          }),
        )
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_live_canvas_snapshot',
    {
      title: 'Get Live Canvas Snapshot',
      description:
        'Return a websocket-native canvas snapshot for agents: rendered text viewport, live objects, and collaborator awareness in one response.',
      inputSchema: {
        canvasId: z.string().optional(),
        startRow: z.number().int().min(0).optional(),
        startCol: z.number().int().min(0).optional(),
        maxRows: z.number().int().min(1).max(400).optional(),
        maxCols: z.number().int().min(1).max(400).optional(),
        trim: z.boolean().optional(),
        padding: z.number().int().min(0).max(20).optional(),
        mode: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        return asToolResult(
          client.getCanvasSnapshot({
            ...input,
            ...(normalizeRenderMode(input.mode) ? { mode: normalizeRenderMode(input.mode) } : {}),
          }),
        )
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_live_canvas_region_snapshot',
    {
      title: 'Get Live Canvas Region Snapshot',
      description:
        'Read one canvas region as both rendered text and canonical JSON object specs so agents can inspect and redraw sections in bulk.',
      inputSchema: {
        canvasId: z.string().optional(),
        top: z.number().int().optional(),
        left: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        type: liveObjectTypeSchema.optional(),
        types: z.array(liveObjectTypeSchema).optional(),
        mode: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        return asToolResult(
          client.getCanvasRegionSnapshot({
            ...input,
            ...(normalizeRenderMode(input.mode) ? { mode: normalizeRenderMode(input.mode) } : {}),
          }),
        )
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'search_live_canvas_text',
    {
      title: 'Search Live Canvas Text',
      description:
        'Search the websocket-native rendered canvas text so an agent can locate labels, regions, or typed content without using the browser.',
      inputSchema: {
        query: z.string(),
        canvasId: z.string().optional(),
        startRow: z.number().int().min(0).optional(),
        startCol: z.number().int().min(0).optional(),
        maxRows: z.number().int().min(1).max(400).optional(),
        maxCols: z.number().int().min(1).max(400).optional(),
        trim: z.boolean().optional(),
        padding: z.number().int().min(0).max(20).optional(),
        mode: z.string().optional(),
        caseSensitive: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        return asToolResult(
          client.searchText({
            ...input,
            ...(normalizeRenderMode(input.mode) ? { mode: normalizeRenderMode(input.mode) } : {}),
          }),
        )
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'list_live_objects',
    {
      title: 'List Live Objects',
      description: 'List the current canvas primitives from the live collaboration room.',
      inputSchema: {
        canvasId: z.string().optional(),
        type: liveObjectTypeSchema.optional(),
        types: z.array(liveObjectTypeSchema).optional(),
        withinTop: z.number().int().optional(),
        withinLeft: z.number().int().optional(),
        withinWidth: z.number().int().positive().optional(),
        withinHeight: z.number().int().positive().optional(),
        intersectsTop: z.number().int().optional(),
        intersectsLeft: z.number().int().optional(),
        intersectsWidth: z.number().int().positive().optional(),
        intersectsHeight: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const hasFilters =
          input.type ||
          (Array.isArray(input.types) && input.types.length > 0) ||
          Number.isInteger(input.withinTop) ||
          Number.isInteger(input.withinLeft) ||
          Number.isInteger(input.withinWidth) ||
          Number.isInteger(input.withinHeight) ||
          Number.isInteger(input.intersectsTop) ||
          Number.isInteger(input.intersectsLeft) ||
          Number.isInteger(input.intersectsWidth) ||
          Number.isInteger(input.intersectsHeight)

        const items = hasFilters ? client.findObjects(input) : client.listObjects(input)
        return asToolResult({
          revision: client.getDocument().version ?? 0,
          canvasId: input.canvasId || client.getDocument().activeCanvasId,
          items,
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'find_live_objects',
    {
      title: 'Find Live Objects',
      description: 'Find live objects by type, text/label content, and region overlap so agents do not have to rely on stale object ids.',
      inputSchema: {
        canvasId: z.string().optional(),
        type: liveObjectTypeSchema.optional(),
        types: z.array(liveObjectTypeSchema).optional(),
        labelContains: z.string().optional(),
        textContains: z.string().optional(),
        withinTop: z.number().int().optional(),
        withinLeft: z.number().int().optional(),
        withinWidth: z.number().int().positive().optional(),
        withinHeight: z.number().int().positive().optional(),
        intersectsTop: z.number().int().optional(),
        intersectsLeft: z.number().int().optional(),
        intersectsWidth: z.number().int().positive().optional(),
        intersectsHeight: z.number().int().positive().optional(),
        caseSensitive: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const items = client.findObjects(input)
        return asToolResult({
          revision: client.getDocument().version ?? 0,
          canvasId: input.canvasId || client.getDocument().activeCanvasId,
          items,
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'list_live_collaborators',
    {
      title: 'List Live Collaborators',
      description: 'List every live collaborator in the room with actor type, cursor, tool, and status.',
      inputSchema: {
        canvasId: z.string().optional(),
      },
    },
    async ({ canvasId }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        return asToolResult(client.listCollaborators({ canvasId }))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'set_live_presence',
    {
      title: 'Set Live Presence',
      description: 'Update the agent cursor, tool, status, or intent in the live collaboration room.',
      inputSchema: {
        canvasId: z.string().optional(),
        row: z.number().int().optional(),
        col: z.number().int().optional(),
        activeTool: z.string().optional(),
        status: z.enum(['idle', 'navigating', 'editing', 'streaming', 'thinking']).optional(),
        intent: z.string().optional(),
      },
    },
    async ({ canvasId, row, col, activeTool, status, intent }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        client.publishPresence({
          activeTool,
          status,
          intent,
          cursor:
            Number.isInteger(row) && Number.isInteger(col)
              ? { canvasId: canvasId || currentTarget.canvasId, row, col }
              : undefined,
        })
        return asToolResult({ ok: true })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_canvas_access',
    {
      title: 'Get Canvas Access',
      description:
        'Resolve the current principal, root access, and per-portal access for the configured canvas target.',
      inputSchema: {},
    },
    async () => {
      try {
        const access = await getCollabAccess(currentTarget)
        return asToolResult(access)
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'list_portals',
    {
      title: 'List Portals',
      description: 'List portals on the current canvas with ids, labels, rects, colors, and resolved access.',
      inputSchema: {},
    },
    async () => {
      try {
        const detail = await getCanvasDetail(currentTarget)
        return asToolResult(
          summarizeCanvas(detail).portals,
        )
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'apply_canvas_action',
    {
      title: 'Apply Canvas Action',
      description:
        'Low-level escape hatch for any Canvascii agent action. Prefer the specialized tools when possible.',
      inputSchema: {
        action: z.object({ type: z.string() }).passthrough(),
      },
    },
    async ({ action }) => {
      try {
        const detail = await applyAgentAction(currentTarget, action)
        return asToolResult(summarizeCanvas(detail))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_text',
    {
      title: 'Create Text',
      description: 'Create a text object at the given row and column.',
      inputSchema: {
        canvasId: z.string().optional(),
        row: z.number().int(),
        col: z.number().int(),
        lines: z.array(z.string()).min(1),
      },
    },
    async ({ canvasId, row, col, lines }) => {
      try {
        const detail = await applyAgentAction(mergeTarget({ canvasId }), {
          type: 'create_text',
          row,
          col,
          lines,
        })
        return asToolResult(summarizeCanvas(detail))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_rectangle',
    {
      title: 'Create Rectangle',
      description: 'Create a rectangle with an optional border title (`label`) and optional body text (`body` or `bodyLines`).',
      inputSchema: {
        canvasId: z.string().optional(),
        top: z.number().int(),
        left: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        label: z.string().optional(),
        body: z.string().optional(),
        bodyLines: z.array(z.string()).optional(),
        labelLines: z.array(z.string()).optional(),
      },
    },
    async ({ canvasId, top, left, width, height, label, body, bodyLines, labelLines }) => {
      try {
        const normalizedBodyLines = normalizeRectangleBodyInput({ body, bodyLines, labelLines })
        const detail = await applyAgentAction(mergeTarget({ canvasId }), {
          type: 'create_rectangle',
          top,
          left,
          width,
          height,
          ...(label ? { label } : {}),
          ...(normalizedBodyLines ? { bodyLines: normalizedBodyLines } : {}),
        })
        return asToolResult(summarizeCanvas(detail))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_line',
    {
      title: 'Create Line',
      description: 'Create a straight line between two points.',
      inputSchema: {
        canvasId: z.string().optional(),
        fromRow: z.number().int(),
        fromCol: z.number().int(),
        toRow: z.number().int(),
        toCol: z.number().int(),
      },
    },
    async ({ canvasId, fromRow, fromCol, toRow, toCol }) => {
      try {
        const detail = await applyAgentAction(mergeTarget({ canvasId }), {
          type: 'create_line',
          from: { row: fromRow, col: fromCol },
          to: { row: toRow, col: toCol },
        })
        return asToolResult(summarizeCanvas(detail))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'upsert_objects_live',
    {
      title: 'Upsert Objects Live',
      description:
        'Apply many object upserts in one live room command batch so agents can draw or patch an entire mockup instantly from JSON.',
      inputSchema: {
        canvasId: z.string().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
        objects: z.array(liveObjectSpecSchema).min(1),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const result = await client.upsertObjects(input)
        return asToolResult({
          upsertedCount: result.upsertedObjectIds.length,
          upsertedObjectIds: result.upsertedObjectIds,
          snapshot: liveSnapshot(client, { canvasId: input.canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'apply_canvas_json_live',
    {
      title: 'Apply Canvas JSON Live',
      description:
        'Apply a whole JSON drawing payload in one call. Use mode=upsert to merge/update objects, or mode=replace-region to clear and redraw one region atomically.',
      inputSchema: {
        canvasId: z.string().optional(),
        mode: z.enum(['upsert', 'replace-region']).optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
        top: z.number().int().optional(),
        left: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        clearTypes: z.array(liveObjectTypeSchema).optional(),
        labelContains: z.string().optional(),
        textContains: z.string().optional(),
        caseSensitive: z.boolean().optional(),
        objects: z.array(liveObjectSpecSchema).min(1),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const result = await client.applyCanvasJson(input)
        return asToolResult({
          mode: result.mode,
          upsertedCount: result.upsertedObjectIds.length,
          upsertedObjectIds: result.upsertedObjectIds,
          deletedCount: result.deletedObjectIds.length,
          deletedObjectIds: result.deletedObjectIds,
          snapshot: liveSnapshot(client, { canvasId: input.canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_text_live',
    {
      title: 'Create Text Live',
      description: 'Create a text object through the live collaboration room and publish live presence while doing it.',
      inputSchema: {
        canvasId: z.string().optional(),
        row: z.number().int(),
        col: z.number().int(),
        lines: z.array(z.string()).min(1),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ canvasId, row, col, lines, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        await client.createText({
          canvasId,
          row,
          col,
          lines,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client, { canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_rectangle_live',
    {
      title: 'Create Rectangle Live',
      description: 'Create a rectangle/box through the live collaboration room. Use `label` for the border title and `body` or `bodyLines` for box body text. Prefer this over overlaying separate text on top of a box. Use stylePreset=wireframe for deterministic unfilled boxes.',
      inputSchema: {
        canvasId: z.string().optional(),
        top: z.number().int(),
        left: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        label: z.string().optional(),
        body: z.string().optional(),
        bodyLines: z.array(z.string()).optional(),
        labelLines: z.array(z.string()).optional(),
        stylePreset: z.enum(['wireframe']).optional(),
        style: rectangleStyleSchema,
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ canvasId, top, left, width, height, label, body, bodyLines, labelLines, stylePreset, style, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        const normalizedBodyLines = normalizeRectangleBodyInput({ body, bodyLines, labelLines })
        await client.createRectangle({
          canvasId,
          top,
          left,
          width,
          height,
          label,
          bodyLines: normalizedBodyLines,
          stylePreset,
          style,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client, { canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_wireframe_rectangle_live',
    {
      title: 'Create Wireframe Rectangle Live',
      description: 'Create a deterministic unfilled wireframe rectangle through the live collaboration room, with optional `label` for the border title and `body` or `bodyLines` for box body text.',
      inputSchema: {
        canvasId: z.string().optional(),
        top: z.number().int(),
        left: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        label: z.string().optional(),
        body: z.string().optional(),
        bodyLines: z.array(z.string()).optional(),
        labelLines: z.array(z.string()).optional(),
        style: rectangleStyleSchema,
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ canvasId, top, left, width, height, label, body, bodyLines, labelLines, style, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        const normalizedBodyLines = normalizeRectangleBodyInput({ body, bodyLines, labelLines })
        await client.createWireframeRectangle({
          canvasId,
          top,
          left,
          width,
          height,
          label,
          bodyLines: normalizedBodyLines,
          style,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client, { canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_line_live',
    {
      title: 'Create Line Live',
      description: 'Create a straight line through the live collaboration room.',
      inputSchema: {
        canvasId: z.string().optional(),
        fromRow: z.number().int(),
        fromCol: z.number().int(),
        toRow: z.number().int(),
        toCol: z.number().int(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ canvasId, fromRow, fromCol, toRow, toCol, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        await client.createLine({
          canvasId,
          from: { row: fromRow, col: fromCol },
          to: { row: toRow, col: toCol },
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client, { canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'create_path_live',
    {
      title: 'Create Path Live',
      description: 'Create an orthogonal multi-segment path through the live collaboration room.',
      inputSchema: {
        canvasId: z.string().optional(),
        points: z.array(
          z.object({
            row: z.number().int(),
            col: z.number().int(),
          }),
        ).min(2),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ canvasId, points, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        await client.createPath({
          canvasId,
          points,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client, { canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'move_object_live',
    {
      title: 'Move Object Live',
      description: 'Move an existing object through the live collaboration room.',
      inputSchema: {
        objectId: z.string(),
        deltaRow: z.number().int(),
        deltaCol: z.number().int(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, deltaRow, deltaCol, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.moveObject({
          objectId,
          deltaRow,
          deltaCol,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'move_objects_live',
    {
      title: 'Move Objects Live',
      description: 'Move a set of existing objects together in one live command batch.',
      inputSchema: {
        objectIds: z.array(z.string()).min(1),
        deltaRow: z.number().int(),
        deltaCol: z.number().int(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectIds, deltaRow, deltaCol, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        const result = await client.moveObjects({
          objectIds,
          deltaRow,
          deltaCol,
          expectedRevision,
        })
        return asToolResult({
          movedCount: result.movedObjectIds.length,
          movedObjectIds: result.movedObjectIds,
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'resize_object_live',
    {
      title: 'Resize Object Live',
      description: 'Resize an existing rectangle through the live collaboration room.',
      inputSchema: {
        objectId: z.string(),
        top: z.number().int().optional(),
        left: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, top, left, width, height, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.resizeObject({
          objectId,
          top,
          left,
          width,
          height,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'get_collaborator_selection_live',
    {
      title: 'Get Collaborator Selection Live',
      description: 'Return the currently selected objects for a live collaborator.',
      inputSchema: {
        actorId: z.string().optional(),
        sessionId: z.string().optional(),
        name: z.string().optional(),
        canvasId: z.string().optional(),
      },
    },
    async ({ actorId, sessionId, name, canvasId }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        return asToolResult(client.getCollaboratorSelection({ actorId, sessionId, name, canvasId }))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'set_text_live',
    {
      title: 'Set Text Live',
      description: 'Replace the contents of an existing text-capable object through the live collaboration room. Works for free text, rectangle body text, and line/path labels.',
      inputSchema: {
        objectId: z.string(),
        text: z.string().optional(),
        lines: z.array(z.string()).optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, text, lines, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.setText({
          objectId,
          ...(Array.isArray(lines) ? { lines } : {}),
          ...(typeof text === 'string' ? { text } : {}),
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'set_text_alignment_live',
    {
      title: 'Set Text Alignment Live',
      description: 'Align a free text object or the body text inside a rectangle. For rectangles this updates the body-text alignment, not the border title.',
      inputSchema: {
        objectId: z.string(),
        alignment: z.enum(['LEFT', 'CENTER', 'RIGHT']),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, alignment, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.setTextAlignment({
          objectId,
          alignment,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'set_rectangle_label_live',
    {
      title: 'Set Rectangle Label Live',
      description: 'Replace the border title of an existing rectangle through the live collaboration room. Prefer this over overlaying a separate text object to simulate a box title.',
      inputSchema: {
        objectId: z.string(),
        text: z.string().optional(),
        lines: z.array(z.string()).optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, text, lines, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.setRectangleLabel({
          objectId,
          ...(Array.isArray(lines) ? { lines } : {}),
          ...(typeof text === 'string' ? { text } : {}),
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'enclose_text_live',
    {
      title: 'Enclose Text Live',
      description: 'Turn an existing free text object into a wireframe rectangle that contains the same text as box body content.',
      inputSchema: {
        objectId: z.string(),
        padding: z.number().int().min(0).max(8).optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, padding, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.encloseText({
          objectId,
          padding,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'delete_objects_by_query_live',
    {
      title: 'Delete Objects By Query Live',
      description: 'Delete live objects by query instead of carrying object ids across stale reads.',
      inputSchema: {
        canvasId: z.string().optional(),
        type: liveObjectTypeSchema.optional(),
        types: z.array(liveObjectTypeSchema).optional(),
        labelContains: z.string().optional(),
        textContains: z.string().optional(),
        withinTop: z.number().int().optional(),
        withinLeft: z.number().int().optional(),
        withinWidth: z.number().int().positive().optional(),
        withinHeight: z.number().int().positive().optional(),
        intersectsTop: z.number().int().optional(),
        intersectsLeft: z.number().int().optional(),
        intersectsWidth: z.number().int().positive().optional(),
        intersectsHeight: z.number().int().positive().optional(),
        caseSensitive: z.boolean().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const result = await client.deleteObjectsByQuery(input)
        return asToolResult({
          deletedCount: result.deletedObjectIds.length,
          deletedObjectIds: result.deletedObjectIds,
          snapshot: liveSnapshot(client, { canvasId: input.canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'clear_region_live',
    {
      title: 'Clear Region Live',
      description: 'Delete every object intersecting a region. Prefer this before structural redraws.',
      inputSchema: {
        canvasId: z.string().optional(),
        top: z.number().int(),
        left: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        type: liveObjectTypeSchema.optional(),
        types: z.array(liveObjectTypeSchema).optional(),
        labelContains: z.string().optional(),
        textContains: z.string().optional(),
        caseSensitive: z.boolean().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const result = await client.clearRegion(input)
        return asToolResult({
          deletedCount: result.deletedObjectIds.length,
          deletedObjectIds: result.deletedObjectIds,
          snapshot: liveSnapshot(client, { canvasId: input.canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'replace_region_live',
    {
      title: 'Replace Region Live',
      description: 'Atomically clear a region and redraw it in one live mutation batch. Prefer this for structured rewrites.',
      inputSchema: {
        canvasId: z.string().optional(),
        top: z.number().int(),
        left: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        clearTypes: z.array(liveObjectTypeSchema).optional(),
        labelContains: z.string().optional(),
        textContains: z.string().optional(),
        caseSensitive: z.boolean().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
        objects: z.array(liveObjectSpecSchema),
      },
    },
    async (input) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId: input.canvasId }))
        const result = await client.replaceRegion(input)
        return asToolResult({
          deletedCount: result.deletedObjectIds.length,
          deletedObjectIds: result.deletedObjectIds,
          createdCount: input.objects.length,
          snapshot: liveSnapshot(client, { canvasId: input.canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'delete_object_live',
    {
      title: 'Delete Object Live',
      description: 'Delete an existing object through the live collaboration room.',
      inputSchema: {
        objectId: z.string(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.deleteObject({
          objectId,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'delete_all_objects_live',
    {
      title: 'Delete All Objects Live',
      description: 'Delete every object on the target canvas through the live collaboration room.',
      inputSchema: {
        canvasId: z.string().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ canvasId, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(mergeTarget({ canvasId }))
        const result = await client.deleteObjectsByQuery({
          canvasId,
          expectedRevision,
        })
        return asToolResult({
          deletedCount: result.deletedObjectIds.length,
          snapshot: liveSnapshot(client, { canvasId }),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'update_text',
    {
      title: 'Update Text',
      description:
        'Replace the contents of a text object by shape id, or by exact row and column. Can optionally create the text object if it does not exist yet.',
      inputSchema: {
        canvasId: z.string().optional(),
        shapeId: z.string().optional(),
        row: z.number().int().optional(),
        col: z.number().int().optional(),
        text: z.string().optional(),
        lines: z.array(z.string()).optional(),
        createIfMissing: z.boolean().optional(),
      },
    },
    async ({ canvasId, ...input }) => {
      try {
        const result = await updateTextShape(mergeTarget({ canvasId }), input)
        return asToolResult({
          shapeId: result.shapeId,
          created: result.created,
          lines: result.lines,
          canvas: summarizeCanvas(result.detail),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'stream_text',
    {
      title: 'Stream Text',
      description:
        'Type text into a text object over time so the canvas updates live. Targets a text object by shape id or by exact row and column.',
      inputSchema: {
        canvasId: z.string().optional(),
        shapeId: z.string().optional(),
        row: z.number().int().optional(),
        col: z.number().int().optional(),
        text: z.string(),
        chunkMode: z.enum(['char', 'word']).optional(),
        tokenDelayMs: z.number().int().min(0).max(5000).optional(),
        clearFirst: z.boolean().optional(),
        createIfMissing: z.boolean().optional(),
      },
    },
    async ({ canvasId, ...input }) => {
      try {
        const result = await streamTextShape(mergeTarget({ canvasId }), input)
        return asToolResult({
          shapeId: result.shapeId,
          created: result.created,
          chunksApplied: result.chunksApplied,
          text: result.text,
          lines: result.lines,
          canvas: summarizeCanvas(result.detail),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'stream_text_live',
    {
      title: 'Stream Text Live',
      description: 'Type into an existing text-capable object through the live collaboration room so peers can watch the cursor and partial updates.',
      inputSchema: {
        objectId: z.string(),
        text: z.string(),
        delayMs: z.number().int().min(0).max(5000).optional(),
        chunkMode: z.enum(['char', 'word']).optional(),
        clearFirst: z.boolean().optional(),
        prefix: z.string().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, text, delayMs, chunkMode, clearFirst, prefix, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.streamText({
          objectId,
          text,
          delayMs,
          chunkMode,
          clearFirst,
          prefix,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'stream_rectangle_label_live',
    {
      title: 'Stream Rectangle Label Live',
      description: 'Type into the label area of an existing rectangle through the live collaboration room. Prefer this over overlaying a text object on top of a box.',
      inputSchema: {
        objectId: z.string(),
        text: z.string(),
        delayMs: z.number().int().min(0).max(5000).optional(),
        chunkMode: z.enum(['char', 'word']).optional(),
        clearFirst: z.boolean().optional(),
        prefix: z.string().optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      },
    },
    async ({ objectId, text, delayMs, chunkMode, clearFirst, prefix, expectedRevision }) => {
      try {
        const client = await ensureLiveClient(currentTarget)
        await client.streamRectangleLabel({
          objectId,
          text,
          delayMs,
          chunkMode,
          clearFirst,
          prefix,
          expectedRevision,
        })
        return asToolResult({
          snapshot: liveSnapshot(client),
        })
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'add_portal',
    {
      title: 'Add Portal',
      description: 'Create a portal overlay on the current canvas.',
      inputSchema: {
        canvasId: z.string().optional(),
        label: z.string().min(1),
        top: z.number().int(),
        left: z.number().int(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        color: z.string().optional(),
      },
    },
    async ({ canvasId, label, top, left, width, height, color }) => {
      try {
        const detail = await applyAgentAction(mergeTarget({ canvasId }), {
          type: 'add_portal',
          label,
          top,
          left,
          width,
          height,
          ...(color ? { color } : {}),
        })
        return asToolResult(summarizeCanvas(detail, { includeSharePolicy: true }))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'update_portal',
    {
      title: 'Update Portal',
      description: 'Move, resize, recolor, or rename a portal. Share-policy actions require an owner session.',
      inputSchema: {
        portalId: z.string(),
        top: z.number().int().optional(),
        left: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        label: z.string().optional(),
        color: z.string().optional(),
        moveContents: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        const detail = await applyAgentAction(currentTarget, {
          type: 'update_portal',
          ...input,
        })
        return asToolResult(summarizeCanvas(detail, { includeSharePolicy: true }))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerTool(
    'delete_portal',
    {
      title: 'Delete Portal',
      description: 'Delete a portal by id. Requires an owner session.',
      inputSchema: {
        portalId: z.string(),
      },
    },
    async ({ portalId }) => {
      try {
        const detail = await applyAgentAction(currentTarget, {
          type: 'delete_portal',
          portalId,
        })
        return asToolResult(summarizeCanvas(detail, { includeSharePolicy: true }))
      } catch (error) {
        return asToolError(error)
      }
    },
  )

  server.registerResource(
    'canvascii-overview',
    'canvascii://current/overview',
    {
      title: 'Current Canvas Overview',
      description: 'A summarized JSON snapshot of the configured Canvascii target.',
      mimeType: 'application/json',
    },
    async () => {
      const detail = await getCanvasDetail(currentTarget)
      const summary = summarizeCanvas(detail)

      return {
        contents: [
          {
            uri: 'canvascii://current/overview',
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'canvascii-edit-plan',
    {
      title: 'Canvas Edit Plan',
      description: 'Generate a concise editing plan before applying changes to a canvas.',
      argsSchema: {
        goal: z.string(),
      },
    },
    ({ goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `You are editing a Canvascii canvas.\n` +
              `Goal: ${goal}\n` +
              `First read the current canvas overview, then propose the smallest safe set of edits, then apply them with the Canvascii tools.\n` +
              `If access is view-only, stop and explain exactly why.`,
          },
        },
      ],
    }),
  )

  return server
}

export async function startServer() {
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return server
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  startServer().catch((error) => {
    console.error('[canvascii-mcp] failed to start', error)
    process.exit(1)
  })
}
