import { canvasciiHealthSchema } from '@canvascii/core'
import { Server } from '@hocuspocus/server'
import { createServer } from 'node:http'
import * as Y from 'yjs'
import { authorizeDocumentUpdate } from './auth/authorize-document-update'
import { handleStatelessCommand } from './commands/handle-stateless-command'
import { collabConfig } from './config'
import { resolvePrincipalFromHeaders } from './auth/resolve-principal'
import { CanvasciiDocumentStore } from './persistence/document-store'

const documentStore = new CanvasciiDocumentStore()
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()

function schedulePersist(documentName: string, document: Y.Doc): void {
  const existing = pendingWrites.get(documentName)
  if (existing) clearTimeout(existing)

  const timeout = setTimeout(() => {
    pendingWrites.delete(documentName)
    void documentStore.store(documentName, Y.encodeStateAsUpdate(document))
  }, 750)

  pendingWrites.set(documentName, timeout)
}

function rejectCurrentMessageAsReadonly(connection: { readOnly: Boolean }) {
  const previous = connection.readOnly
  connection.readOnly = true
  setTimeout(() => {
    connection.readOnly = previous
  }, 0)
}

async function start(): Promise<void> {
  await documentStore.ensureReady()

  const collabServer = Server.configure({
    port: collabConfig.port,
    async onAuthenticate(data) {
      const { principal, access } = await resolvePrincipalFromHeaders(
        data.documentName,
        data.requestHeaders ?? {},
        typeof data.token === 'string' ? data.token : null,
      )
      data.connection.readOnly = !access.canEditSomewhere
      return {
        principal,
        access,
      }
    },
    async onLoadDocument(data) {
      const update = await documentStore.load(data.documentName)
      if (update && update.byteLength > 0) {
        Y.applyUpdate(data.document, update)
      }
    },
    async beforeHandleMessage(data) {
      const authorization = authorizeDocumentUpdate({
        document: data.document,
        access: (data.context as { access?: unknown } | null)?.access as never,
        update: data.update,
      })

      if (!authorization.allowed) {
        console.warn('[canvascii-collab] rejected room update', {
          documentName: data.documentName,
          socketId: data.socketId,
          rejectedCommands: authorization.rejectedCommands?.map((command) => command.type) ?? [],
          reason: authorization.reason,
        })
        rejectCurrentMessageAsReadonly(data.connection)
      }
    },
    async onStateless(payload) {
      await handleStatelessCommand({
        payload,
        onApplied(documentName, document) {
          schedulePersist(documentName, document)
        },
      })
    },
    async onChange(data) {
      schedulePersist(data.documentName, data.document)
    },
    async onDisconnect(data) {
      await documentStore.store(data.documentName, Y.encodeStateAsUpdate(data.document))
    },
  })

  await collabServer.listen()

  const healthServer = createServer((request, response) => {
    if (!request.url?.startsWith('/health')) {
      response.statusCode = 404
      response.end('Not found')
      return
    }

    const summary = documentStore.getHealthSummary()
    const payload = canvasciiHealthSchema.parse({
      status: 'ok',
      service: 'canvascii-collab',
      authMode: collabConfig.allowDevAuthBypass ? 'better-auth-with-dev-bypass' : 'better-auth',
      documentsPersisted: summary.documentsPersisted,
      lastPersistedAt: summary.lastPersistedAt,
      localSnapshotDir: summary.localSnapshotDir,
      s3Enabled: summary.s3Enabled,
      s3Bucket: summary.s3Bucket,
    })

    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(payload, null, 2))
  })

  healthServer.listen(collabConfig.healthPort, () => {
    console.log(
      `[canvascii-collab] ws=:${collabConfig.port} health=:${collabConfig.healthPort} auth=${collabConfig.allowDevAuthBypass ? 'better-auth+dev-bypass' : 'better-auth'}`,
    )
  })
}

void start().catch((error) => {
  console.error('[canvascii-collab] failed to start', error)
  process.exitCode = 1
})
