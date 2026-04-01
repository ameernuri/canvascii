import { CanvasciiAgentClient } from './index.mjs'

function trimOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readIntEnv(name) {
  const value = process.env[name]
  if (value == null || value === '') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}

function printJson(label, value) {
  process.stdout.write(`\n[${label}]\n${JSON.stringify(value, null, 2)}\n`)
}

const shareUrl = trimOrNull(process.env.CANVASCII_SHARE_URL)
if (!shareUrl) {
  throw new Error('CANVASCII_SHARE_URL is required.')
}

const viewport = {
  startRow: readIntEnv('CANVASCII_VIEW_START_ROW'),
  startCol: readIntEnv('CANVASCII_VIEW_START_COL'),
  maxRows: readIntEnv('CANVASCII_VIEW_MAX_ROWS') ?? 40,
  maxCols: readIntEnv('CANVASCII_VIEW_MAX_COLS') ?? 120,
}

const searchQuery = trimOrNull(process.env.CANVASCII_SEARCH_QUERY)

const client = CanvasciiAgentClient.fromShareUrl(shareUrl, {
  name: trimOrNull(process.env.CANVASCII_AGENT_NAME) || 'Canvascii Observer',
  actorId: trimOrNull(process.env.CANVASCII_AGENT_ID) || 'agent:canvascii-observer',
  activeTool: 'SELECT',
})

await client.connect()
printJson('connected', {
  canvasId: client.canvasId,
  actorId: client.actorId,
  sessionId: client.sessionId,
})

const stop = client.observeCanvas((event) => {
  const summary = {
    reason: event.reason,
    changes: event.changes,
    collaborators: event.collaborators.map((entry) => ({
      name: entry.name,
      actorType: entry.actorType,
      activeTool: entry.activeTool,
      status: entry.status,
      cursor: entry.cursor,
      intent: entry.intent,
    })),
    rendered: event.snapshot.rendered,
  }
  printJson('event', summary)

  if (searchQuery) {
    printJson('search', client.searchText({
      ...viewport,
      query: searchQuery,
      limit: 20,
    }))
  }
}, viewport)

const shutdown = () => {
  stop()
  client.disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
