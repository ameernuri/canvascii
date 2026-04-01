import { CanvasciiAgentClient } from '../packages/canvascii-agent-client/index.mjs'

function trimOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readIntEnv(name, fallback) {
  const value = process.env[name]
  if (value == null || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check, { timeoutMs = 10_000, intervalMs = 150, label = 'condition' } = {}) {
  const startedAt = Date.now()
  let lastValue = null
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await check()
    if (lastValue) return lastValue
    await sleep(intervalMs)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

function printJson(label, value) {
  process.stdout.write(`\n[${label}]\n${JSON.stringify(value, null, 2)}\n`)
}

function createAgent(shareUrl, name, color) {
  return CanvasciiAgentClient.fromShareUrl(shareUrl, {
    agentName: name,
    agentColor: color,
    activeTool: 'SELECT',
  })
}

function getUniqueVisibleCollaborators(collaborators) {
  const seen = new Set()
  return collaborators.filter((entry) => {
    const key = entry.actorId || entry.sessionId || entry.name
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const shareUrl = trimOrNull(process.env.CANVASCII_SHARE_URL)
if (!shareUrl) {
  throw new Error('CANVASCII_SHARE_URL is required.')
}

const top = readIntEnv('CANVASCII_SMOKE_TOP', 56)
const left = readIntEnv('CANVASCII_SMOKE_LEFT', 8)
const width = readIntEnv('CANVASCII_SMOKE_WIDTH', 32)
const height = readIntEnv('CANVASCII_SMOKE_HEIGHT', 8)
const bodyPrefix = trimOrNull(process.env.CANVASCII_SMOKE_LABEL) || `smoke-${Date.now()}`

const alpha = createAgent(shareUrl, 'Smoke Alpha', '#22c55e')
const beta = createAgent(shareUrl, 'Smoke Beta', '#38bdf8')
const gamma = createAgent(shareUrl, 'Smoke Gamma', '#f59e0b')
const clients = [alpha, beta, gamma]

const cleanupObjectIds = new Set()

async function main() {
  try {
    await Promise.all(clients.map((client) => client.connect()))

    await Promise.all([
      alpha.publishPresence({
        activeTool: 'TEXT',
        status: 'editing',
        intent: 'smoke create',
        cursor: { canvasId: alpha.canvasId, row: top, col: left },
      }),
      beta.publishPresence({
        activeTool: 'SELECT',
        status: 'reviewing',
        intent: 'smoke patch',
        cursor: { canvasId: beta.canvasId, row: top + 2, col: left + 4 },
      }),
      gamma.publishPresence({
        activeTool: 'SELECT',
        status: 'observing',
        intent: 'smoke verify',
        cursor: { canvasId: gamma.canvasId, row: top + 4, col: left + 8 },
      }),
    ])

    const collaborators = await waitFor(
      () => {
        const entries = getUniqueVisibleCollaborators(alpha.listCollaborators({ canvasId: alpha.canvasId }))
        const required = ['Smoke Alpha', 'Smoke Beta', 'Smoke Gamma']
        return required.every((name) => entries.some((entry) => entry.name === name)) ? entries : null
      },
      { label: 'all smoke agents to appear as visible collaborators' },
    )

    await alpha.createWireframeRectangle({
      canvasId: alpha.canvasId,
      top,
      left,
      width,
      height,
      label: 'Smoke Draft',
      labelLines: [bodyPrefix, 'owned by alpha'],
    })
    const createdObject = await waitFor(
      () => beta.findObjects({ canvasId: beta.canvasId, labelContains: 'Smoke Draft' })[0] ?? null,
      { label: 'beta to see alpha rectangle' },
    )
    const objectId = createdObject.id
    cleanupObjectIds.add(objectId)
    const baseRevision = beta.getDocument().version ?? 0
    await beta.patchObject({
      objectId,
      title: 'Smoke Final',
      body: `${bodyPrefix}\npatched by beta`,
      expectedRevision: baseRevision,
    })

    let conflictMessage = null
    try {
      await gamma.patchObject({
        objectId,
        body: `${bodyPrefix}\nstale write from gamma`,
        expectedRevision: baseRevision,
      })
    } catch (error) {
      conflictMessage = error instanceof Error ? error.message : String(error)
    }

    if (!conflictMessage || !/Revision mismatch/i.test(conflictMessage)) {
      throw new Error('Expected a revision conflict during the smoke test, but none was raised.')
    }

    const finalObject = await waitFor(
      () => gamma.findObjects({ canvasId: gamma.canvasId, labelContains: 'Smoke Final' })[0] ?? null,
      { label: 'gamma to observe beta patch' },
    )
    await alpha.waitForDocumentVersion(beta.getDocument().version ?? null)

    const deletedDocuments = await Promise.all(
      Array.from(cleanupObjectIds).map((objectId) =>
        alpha.deleteObject({
          objectId,
          expectedRevision: alpha.getDocument().version ?? undefined,
        }),
      ),
    )
    const deleteRevision = Math.max(...deletedDocuments.map((document) => document.version ?? 0))
    await beta.waitForDocumentVersion(deleteRevision)

    await waitFor(
      () => {
        const liveIds = new Set(beta.getDocument().objects.map((object) => object.id))
        return Array.from(cleanupObjectIds).every((objectId) => !liveIds.has(objectId))
      },
      { label: 'smoke objects to be cleaned up' },
    )

    printJson('summary', {
      canvasId: alpha.canvasId,
      collaborators: collaborators.map((entry) => ({
        name: entry.name,
        actorId: entry.actorId,
        status: entry.status,
        activeTool: entry.activeTool,
      })),
      createdObjectId: objectId,
      finalObject,
      conflictMessage,
      cleanedUp: true,
    })
  } finally {
    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          client.disconnect()
        } catch {}
      }),
    )
  }
}

await main()
process.exit(0)
