import {
  applyCanvasCommands,
  createDefaultCanvasSharePolicy,
  filterCanvasCommandsByAccess,
  resolveCanvasAccess,
  type CanvasAccessPrincipal,
  type CanvasAccessSummary,
  type CanvasCommand,
  type CanvasDocument,
  type CanvasEvent,
  type CanvasSharePolicy,
} from '@canvascii/core'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { QueryResultRow } from 'pg'
import { initAppState, type AppState } from '@/components/asciip-core/store/appSlice'
import { canvasDocumentToEditorState } from '@/lib/canvascii/document-bridge'
import { projectEditorStateThroughCommands } from '@/lib/canvascii/command-projection'
import { canvasciiPgPool } from './pg'

type StoredCanvasRecord = {
  id: string
  ownerUserId: string
  ownerEmail: string | null
  /** Opaque database storage key. This is not a filesystem path. */
  storageKey: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  editorState: AppState
  document: CanvasDocument
  commands: CanvasCommand[]
  events: CanvasEvent[]
  sharePolicy: CanvasSharePolicy
}

type LoadedCanvasRecord = {
  ownerUserId: string
  record: StoredCanvasRecord
  sizeBytes: number
}

type CanvasRow = QueryResultRow & {
  id: string
  owner_user_id: string
  owner_email: string | null
  storage_key: string
  title: string
  revision: number
  created_at: string | Date
  updated_at: string | Date
  editor_state: AppState | string
  document: CanvasDocument | string
  commands: CanvasCommand[] | string
  events: CanvasEvent[] | string
  share_policy: CanvasSharePolicy | string
}

type StoredCanvasShareRecord = {
  id: string
  ownerUserId: string
  ownerEmail: string | null
  storageKey: string
  title: string
  revision: number
  updatedAt: string
  documentId: string
  sharePolicy: CanvasSharePolicy
}

type LoadedCanvasShareRecord = {
  ownerUserId: string
  record: StoredCanvasShareRecord
}

type CanvasShareRow = QueryResultRow & {
  id: string
  owner_user_id: string
  owner_email: string | null
  storage_key: string
  title: string
  revision: number
  updated_at: string | Date
  document_id: string
  share_policy: CanvasSharePolicy | string
}

export type CanvasSummary = {
  id: string
  storageKey: string
  name: string
  title: string
  sizeBytes: number
  revision: number
  updatedAt: string
  etag: string
  ownerUserId: string
  ownerEmail: string | null
  isShared: boolean
  accessSummary: CanvasAccessSummary
}

export type CanvasDetail = CanvasSummary & {
  editorState: Record<string, unknown>
  documentId: string
  sharePolicy: CanvasSharePolicy
}

export type CanvasShareDetail = CanvasSummary & {
  documentId: string
  sharePolicy: CanvasSharePolicy
}

function storageKeyBaseName(storageKey: string) {
  return path.posix.basename(storageKey)
}

function normalizeStorageKey(input: string): string {
  const trimmed = input.trim().replace(/^\/+/, '')
  const normalized = path.posix.normalize(trimmed)
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Invalid canvas storage key.')
  }
  return normalized
}

function buildStorageKey(input: { storageKey?: string; directory?: string; name?: string }): string {
  const explicitStorageKey = input.storageKey?.trim()
  if (explicitStorageKey) {
    return normalizeStorageKey(explicitStorageKey)
  }

  const name = input.name?.trim()
  if (!name) {
    throw new Error('Canvas storage key is required.')
  }

  const directory = input.directory?.trim() ? `${normalizeStorageKey(input.directory)}/` : ''
  return normalizeStorageKey(`${directory}${name}`)
}

function hashRecord(record: Pick<StoredCanvasRecord, 'id' | 'revision' | 'updatedAt'>): string {
  return createHash('sha1').update(`${record.id}:${record.revision}:${record.updatedAt}`).digest('hex')
}

function parseJsonColumn<T>(value: T | string): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T
  }
  return value
}

function normalizeCanvasLookupId(input: string): string {
  return input.startsWith('canvascii:') ? input.slice('canvascii:'.length) : input
}

export class CanvasLibraryStore {
  private static schemaReadyPromise: Promise<void> | null = null

  private async ensureReady() {
    await this.ensureSchema()
  }

  private async ensureSchema() {
    if (!CanvasLibraryStore.schemaReadyPromise) {
      CanvasLibraryStore.schemaReadyPromise = (async () => {
        await canvasciiPgPool.query(`
          CREATE TABLE IF NOT EXISTS canvases (
            id text PRIMARY KEY,
            owner_user_id text NOT NULL,
            owner_email text,
            storage_key text NOT NULL,
            title text NOT NULL,
            revision integer NOT NULL,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL,
            document_id text NOT NULL,
            editor_state jsonb NOT NULL,
            document jsonb NOT NULL,
            commands jsonb NOT NULL,
            events jsonb NOT NULL,
            share_policy jsonb NOT NULL
          )
        `)
        await canvasciiPgPool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS canvases_owner_storage_key_idx
          ON canvases (owner_user_id, storage_key)
        `)
        await canvasciiPgPool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS canvases_document_id_idx
          ON canvases (document_id)
        `)
        await canvasciiPgPool.query(`
          CREATE INDEX IF NOT EXISTS canvases_owner_updated_idx
          ON canvases (owner_user_id, updated_at DESC)
        `)
        await canvasciiPgPool.query(`
          CREATE INDEX IF NOT EXISTS canvases_updated_idx
          ON canvases (updated_at DESC)
        `)
        // One-time cleanup for older local dev databases.
        await canvasciiPgPool.query(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'canvas_files'
            ) THEN
              INSERT INTO canvases (
                id,
                owner_user_id,
                owner_email,
                storage_key,
                title,
                revision,
                created_at,
                updated_at,
                document_id,
                editor_state,
                document,
                commands,
                events,
                share_policy
              )
              SELECT
                id,
                owner_user_id,
                owner_email,
                path AS storage_key,
                title,
                revision,
                created_at,
                updated_at,
                document_id,
                editor_state,
                document,
                commands,
                events,
                share_policy
              FROM canvas_files
              ON CONFLICT (id) DO NOTHING;

              DROP TABLE canvas_files;
            END IF;
          END $$;
        `).catch(() => {})
      })()
    }

    await CanvasLibraryStore.schemaReadyPromise
  }

  private rowToLoaded(row: CanvasRow): LoadedCanvasRecord {
    const record: StoredCanvasRecord = {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerEmail: row.owner_email,
      storageKey: row.storage_key,
      title: row.title,
      revision: row.revision,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      editorState: parseJsonColumn<AppState>(row.editor_state),
      document: parseJsonColumn<CanvasDocument>(row.document),
      commands: parseJsonColumn<CanvasCommand[]>(row.commands),
      events: parseJsonColumn<CanvasEvent[]>(row.events),
      sharePolicy: parseJsonColumn<CanvasSharePolicy>(row.share_policy),
    }

    return {
      ownerUserId: row.owner_user_id,
      record,
      sizeBytes: Buffer.byteLength(JSON.stringify(record)),
    }
  }

  private async readRecordById(id: string): Promise<LoadedCanvasRecord | null> {
    await this.ensureReady()
    const lookupId = normalizeCanvasLookupId(id)
    const result = await canvasciiPgPool.query<CanvasRow>(
      `
        SELECT *
        FROM canvases
        WHERE id = $1
           OR document_id = $1
        LIMIT 1
      `,
      [lookupId],
    )
    return result.rows[0] ? this.rowToLoaded(result.rows[0]) : null
  }

  private rowToLoadedShare(row: CanvasShareRow): LoadedCanvasShareRecord {
    return {
      ownerUserId: row.owner_user_id,
      record: {
        id: row.id,
        ownerUserId: row.owner_user_id,
        ownerEmail: row.owner_email,
        storageKey: row.storage_key,
        title: row.title,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
        documentId: row.document_id,
        sharePolicy: parseJsonColumn<CanvasSharePolicy>(row.share_policy),
      },
    }
  }

  private async readShareRecordById(id: string): Promise<LoadedCanvasShareRecord | null> {
    await this.ensureReady()
    const lookupId = normalizeCanvasLookupId(id)
    const result = await canvasciiPgPool.query<CanvasShareRow>(
      `
        SELECT id, owner_user_id, owner_email, storage_key, title, revision, updated_at, document_id, share_policy
        FROM canvases
        WHERE id = $1
           OR document_id = $1
        LIMIT 1
      `,
      [lookupId],
    )
    return result.rows[0] ? this.rowToLoadedShare(result.rows[0]) : null
  }

  private async readRecordByOwnerStorageKey(ownerUserId: string, storageKey: string): Promise<LoadedCanvasRecord | null> {
    await this.ensureReady()
    const result = await canvasciiPgPool.query<CanvasRow>(
      `
        SELECT *
        FROM canvases
        WHERE owner_user_id = $1
          AND storage_key = $2
        LIMIT 1
      `,
      [ownerUserId, normalizeStorageKey(storageKey)],
    )
    return result.rows[0] ? this.rowToLoaded(result.rows[0]) : null
  }

  private async persistRecord(record: StoredCanvasRecord) {
    await this.ensureSchema()
    await canvasciiPgPool.query(
      `
        INSERT INTO canvases (
          id,
          owner_user_id,
          owner_email,
          storage_key,
          title,
          revision,
          created_at,
          updated_at,
          document_id,
          editor_state,
          document,
          commands,
          events,
          share_policy
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          owner_user_id = EXCLUDED.owner_user_id,
          owner_email = EXCLUDED.owner_email,
          storage_key = EXCLUDED.storage_key,
          title = EXCLUDED.title,
          revision = EXCLUDED.revision,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          document_id = EXCLUDED.document_id,
          editor_state = EXCLUDED.editor_state,
          document = EXCLUDED.document,
          commands = EXCLUDED.commands,
          events = EXCLUDED.events,
          share_policy = EXCLUDED.share_policy
      `,
      [
        record.id,
        record.ownerUserId,
        record.ownerEmail,
        record.storageKey,
        record.title,
        record.revision,
        record.createdAt,
        record.updatedAt,
        record.document.id,
        JSON.stringify(record.editorState),
        JSON.stringify(record.document),
        JSON.stringify(record.commands),
        JSON.stringify(record.events),
        JSON.stringify(record.sharePolicy),
      ],
    )
  }

  private async persistSharePolicyOnly(input: {
    id: string
    revision: number
    updatedAt: string
    sharePolicy: CanvasSharePolicy
  }) {
    await this.ensureSchema()
    const result = await canvasciiPgPool.query(
      `
        UPDATE canvases
        SET revision = $2,
            updated_at = $3::timestamptz,
            share_policy = $4::jsonb
        WHERE id = $1
      `,
      [input.id, input.revision, input.updatedAt, JSON.stringify(input.sharePolicy)],
    )

    if (!result.rowCount) {
      throw new Error('Canvas not found.')
    }
  }

  private toSummary(loaded: LoadedCanvasRecord, principal: CanvasAccessPrincipal): CanvasSummary {
    const { record, sizeBytes, ownerUserId } = loaded
    const accessSummary = resolveCanvasAccess(record.sharePolicy, principal, record.document.id)

    return {
      id: record.id,
      storageKey: record.storageKey,
      name: storageKeyBaseName(record.storageKey),
      title: record.title,
      sizeBytes,
      revision: record.revision,
      updatedAt: record.updatedAt,
      etag: hashRecord(record),
      ownerUserId,
      ownerEmail: record.ownerEmail,
      isShared: ownerUserId !== principal.userId,
      accessSummary,
    }
  }

  private toDetail(loaded: LoadedCanvasRecord, principal: CanvasAccessPrincipal): CanvasDetail {
    const summary = this.toSummary(loaded, principal)

    return {
      ...summary,
      editorState: loaded.record.editorState as unknown as Record<string, unknown>,
      documentId: loaded.record.document.id,
      sharePolicy: loaded.record.sharePolicy,
    }
  }

  private toShareDetail(loaded: LoadedCanvasRecord, principal: CanvasAccessPrincipal): CanvasShareDetail {
    const summary = {
      id: loaded.record.id,
      storageKey: loaded.record.storageKey,
      name: storageKeyBaseName(loaded.record.storageKey),
      title: loaded.record.title,
      sizeBytes: 0,
      revision: loaded.record.revision,
      updatedAt: loaded.record.updatedAt,
      etag: hashRecord({
        id: loaded.record.id,
        revision: loaded.record.revision,
        updatedAt: loaded.record.updatedAt,
      }),
      ownerUserId: loaded.ownerUserId,
      ownerEmail: loaded.record.ownerEmail,
      isShared: loaded.ownerUserId !== principal.userId,
      accessSummary: resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.document.id),
    }

    return {
      ...summary,
      documentId: loaded.record.document.id,
      sharePolicy: loaded.record.sharePolicy,
    }
  }

  private toLightShareDetail(loaded: LoadedCanvasShareRecord, principal: CanvasAccessPrincipal): CanvasShareDetail {
    return {
      id: loaded.record.id,
      storageKey: loaded.record.storageKey,
      name: storageKeyBaseName(loaded.record.storageKey),
      title: loaded.record.title,
      sizeBytes: 0,
      revision: loaded.record.revision,
      updatedAt: loaded.record.updatedAt,
      etag: hashRecord({
        id: loaded.record.id,
        revision: loaded.record.revision,
        updatedAt: loaded.record.updatedAt,
      }),
      ownerUserId: loaded.ownerUserId,
      ownerEmail: loaded.record.ownerEmail,
      isShared: loaded.ownerUserId !== principal.userId,
      accessSummary: resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.documentId),
      documentId: loaded.record.documentId,
      sharePolicy: loaded.record.sharePolicy,
    }
  }

  private async findRecordById(id: string): Promise<LoadedCanvasRecord | null> {
    return this.readRecordById(id)
  }

  private async getOwnedByStorageKey(ownerUserId: string, storageKey: string): Promise<LoadedCanvasRecord | null> {
    return this.readRecordByOwnerStorageKey(ownerUserId, storageKey)
  }

  private assertReadable(record: StoredCanvasRecord, principal: CanvasAccessPrincipal): CanvasAccessSummary {
    const accessSummary = resolveCanvasAccess(record.sharePolicy, principal, record.document.id)
    if (!accessSummary.canRead) {
      throw new Error('Canvas not found.')
    }
    return accessSummary
  }

  private assertWritable(record: StoredCanvasRecord, principal: CanvasAccessPrincipal): CanvasAccessSummary {
    const accessSummary = this.assertReadable(record, principal)
    if (!accessSummary.canEditSomewhere) {
      throw new Error('You only have view access to this canvas.')
    }
    return accessSummary
  }

  private async queryAccessibleCandidates(principal: CanvasAccessPrincipal, limit: number): Promise<LoadedCanvasRecord[]> {
    await this.ensureReady()
    const result = await canvasciiPgPool.query<CanvasRow>(
      `
        SELECT *
        FROM canvases
        WHERE owner_user_id = $1
           OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(share_policy->'grants') AS share_grant
             WHERE share_grant->>'subjectType' = 'user'
               AND share_grant->>'subjectId' = $1
           )
           OR (
             $2::text IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements(share_policy->'grants') AS share_grant
               WHERE share_grant->>'subjectType' = 'email'
                 AND lower(share_grant->>'subjectId') = lower($2::text)
             )
           )
           OR (
             $3::text IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements(share_policy->'grants') AS share_grant
               WHERE share_grant->>'subjectType' = 'link'
                 AND share_grant->>'subjectId' = $3::text
             )
           )
        ORDER BY updated_at DESC
        LIMIT $4
      `,
      [principal.userId, principal.email ?? null, principal.shareToken ?? null, Math.max(limit, 1000)],
    )

    return result.rows.map((row) => this.rowToLoaded(row))
  }

  async listAccessible(principal: CanvasAccessPrincipal, options?: { query?: string; directory?: string; limit?: number }) {
    const directory = options?.directory?.trim() ? normalizeStorageKey(options.directory) : null
    const query = options?.query?.trim().toLowerCase() ?? ''
    const loadedRecords = await this.queryAccessibleCandidates(principal, options?.limit ?? 1000)

    const summaries = loadedRecords
      .map((loaded) => this.toSummary(loaded, principal))
      .filter((item) => item.accessSummary.canRead)
      .filter((item) => (directory ? item.storageKey.startsWith(`${directory}/`) || item.storageKey === directory : true))
      .filter((item) => {
        if (!query) return true
        return `${item.storageKey} ${item.title} ${item.ownerEmail ?? ''}`.toLowerCase().includes(query)
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

    return {
      rootStorageKey: null,
      canvases: summaries.slice(0, options?.limit ?? 1000),
    }
  }

  async getAccessibleById(principal: CanvasAccessPrincipal, id: string): Promise<CanvasDetail | null> {
    const loaded = await this.findRecordById(id)
    if (!loaded) return null
    const accessSummary = resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.document.id)
    if (!accessSummary.canRead) return null
    return this.toDetail(loaded, principal)
  }

  async getAccessibleShareById(principal: CanvasAccessPrincipal, id: string): Promise<CanvasShareDetail | null> {
    const loaded = await this.readShareRecordById(id)
    if (!loaded) return null
    const accessSummary = resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.documentId)
    if (!accessSummary.canRead) return null
    return this.toLightShareDetail(loaded, principal)
  }

  async getOwned(ownerUserId: string, storageKey: string): Promise<CanvasDetail | null> {
    const loaded = await this.getOwnedByStorageKey(ownerUserId, storageKey)
    if (!loaded) return null
    return this.toDetail(loaded, { userId: ownerUserId, email: loaded.record.ownerEmail })
  }

  async create(
    userId: string,
    input: {
      storageKey?: string
      name?: string
      directory?: string
      title?: string
      editorState?: Record<string, unknown>
      commands?: CanvasCommand[]
      overwrite?: boolean
      ownerEmail?: string | null
    },
  ): Promise<CanvasDetail> {
    await this.ensureReady()
    const storageKey = buildStorageKey(input)
    const existing = await this.getOwnedByStorageKey(userId, storageKey)
    if (existing && !input.overwrite) {
      throw new Error('A canvas already exists at that storage key.')
    }
    if (existing && input.overwrite) {
      await canvasciiPgPool.query(
        `
          DELETE FROM canvases
          WHERE owner_user_id = $1
            AND storage_key = $2
        `,
        [userId, storageKey],
      )
    }

    const now = new Date().toISOString()
    const editorState = (input.editorState ?? initAppState()) as AppState
    const documentId = randomUUID()
    const normalizedCommands =
      Array.isArray(input.commands) && input.commands.length > 0
        ? input.commands.map((command) => ({
            ...command,
            actorId: userId,
          }))
        : null
    const projection = normalizedCommands
      ? (() => {
          const applied = applyCanvasCommands(
            {
              id: documentId,
              activeCanvasId: '',
              canvases: [],
              regions: [],
              objects: [],
              createdAt: now,
              updatedAt: now,
              version: 0,
              metadata: {
                documentName: storageKey,
              },
            },
            normalizedCommands,
          )
          return {
            document: applied.document,
            commands: normalizedCommands,
            events: applied.events,
          }
        })()
      : projectEditorStateThroughCommands({
          previousDocument: null,
          editorState,
          documentId,
          documentName: storageKey,
          createdAt: now,
          updatedAt: now,
          actorId: userId,
        })
    const record: StoredCanvasRecord = {
      id: randomUUID(),
      ownerUserId: userId,
      ownerEmail: input.ownerEmail ?? null,
      storageKey,
      title: input.title?.trim() || storageKeyBaseName(storageKey),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      editorState,
      document: projection.document,
      commands: projection.commands,
      events: projection.events,
      sharePolicy: createDefaultCanvasSharePolicy({
        ownerUserId: userId,
        ownerEmail: input.ownerEmail ?? null,
        updatedAt: now,
      }),
    }

    await this.persistRecord(record)
    return this.toDetail(
      {
        ownerUserId: userId,
        record,
        sizeBytes: Buffer.byteLength(JSON.stringify(record)),
      },
      { userId, email: input.ownerEmail ?? null },
    )
  }

  async updateAccessible(
    principal: CanvasAccessPrincipal,
    input: {
      id?: string
      storageKey?: string
      editorState: Record<string, unknown>
      commands?: CanvasCommand[]
      ifMatchEtag?: string
    },
  ): Promise<CanvasDetail> {
    const loaded = input.id
      ? await this.findRecordById(input.id)
      : input.storageKey
        ? await this.getOwnedByStorageKey(principal.userId, input.storageKey)
        : null

    if (!loaded) {
      throw new Error('Canvas not found.')
    }

    this.assertWritable(loaded.record, principal)

    const currentEtag = hashRecord(loaded.record)
    if (input.ifMatchEtag && input.ifMatchEtag !== currentEtag) {
      throw new Error('Canvas has changed since it was opened.')
    }

    const now = new Date().toISOString()
    const editorState = input.editorState as AppState
    const normalizedCommands =
      Array.isArray(input.commands) && input.commands.length > 0
        ? input.commands.map((command) => ({
            ...command,
            actorId: principal.userId,
          }))
        : null

    const projection = normalizedCommands
      ? (() => {
          const applied = applyCanvasCommands(loaded.record.document, normalizedCommands)
          return {
            document: applied.document,
            commands: normalizedCommands,
            events: applied.events,
          }
        })()
      : projectEditorStateThroughCommands({
          previousDocument: loaded.record.document,
          editorState,
          documentId: loaded.record.document.id,
          documentName: loaded.record.storageKey,
          createdAt: loaded.record.document.createdAt,
          updatedAt: now,
          actorId: principal.userId,
        })

    const authorization = filterCanvasCommandsByAccess({
      access: resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.document.id),
      previousDocument: loaded.record.document,
      commands: projection.commands,
    })

    if (authorization.rejectedCommands.length > 0) {
      throw new Error('Some changes are outside the areas you can edit.')
    }

    const nextRecord: StoredCanvasRecord = {
      ...loaded.record,
      revision: loaded.record.revision + 1,
      updatedAt: now,
      editorState,
      document: projection.document,
      commands: [...loaded.record.commands, ...projection.commands],
      events: [...loaded.record.events, ...projection.events],
      sharePolicy: {
        ...loaded.record.sharePolicy,
        updatedAt: loaded.record.sharePolicy.updatedAt,
      },
    }

    await this.persistRecord(nextRecord)
    return this.toDetail(
      {
        ownerUserId: loaded.ownerUserId,
        record: nextRecord,
        sizeBytes: Buffer.byteLength(JSON.stringify(nextRecord)),
      },
      principal,
    )
  }

  async saveOwnerEditorStateAndSharePolicy(
    ownerUserId: string,
    input: {
      id: string
      editorState: Record<string, unknown>
      sharePolicy: CanvasSharePolicy
      commands?: CanvasCommand[]
    },
  ): Promise<CanvasDetail> {
    const loaded = await this.findRecordById(input.id)
    if (!loaded || loaded.ownerUserId !== ownerUserId) {
      throw new Error('Canvas not found.')
    }

    const principal: CanvasAccessPrincipal = {
      userId: ownerUserId,
      email: loaded.record.ownerEmail,
    }
    const now = new Date().toISOString()
    const editorState = input.editorState as AppState
    const normalizedCommands =
      Array.isArray(input.commands) && input.commands.length > 0
        ? input.commands.map((command) => ({
            ...command,
            actorId: ownerUserId,
          }))
        : null

    const projection = normalizedCommands
      ? (() => {
          const applied = applyCanvasCommands(loaded.record.document, normalizedCommands)
          return {
            document: applied.document,
            commands: normalizedCommands,
            events: applied.events,
          }
        })()
      : projectEditorStateThroughCommands({
          previousDocument: loaded.record.document,
          editorState,
          documentId: loaded.record.document.id,
          documentName: loaded.record.storageKey,
          createdAt: loaded.record.document.createdAt,
          updatedAt: now,
          actorId: ownerUserId,
        })

    const nextRecord: StoredCanvasRecord = {
      ...loaded.record,
      revision: loaded.record.revision + 1,
      updatedAt: now,
      editorState,
      document: projection.document,
      commands: [...loaded.record.commands, ...projection.commands],
      events: [...loaded.record.events, ...projection.events],
      sharePolicy: {
        ...input.sharePolicy,
        ownerUserId,
        ownerEmail: loaded.record.ownerEmail,
        updatedAt: now,
      },
    }

    await this.persistRecord(nextRecord)
    return this.toDetail(
      {
        ownerUserId,
        record: nextRecord,
        sizeBytes: Buffer.byteLength(JSON.stringify(nextRecord)),
      },
      principal,
    )
  }

  async saveAccessibleEditorStateAndSharePolicy(
    principal: CanvasAccessPrincipal,
    input: {
      id: string
      editorState: Record<string, unknown>
      sharePolicy: CanvasSharePolicy
      commands?: CanvasCommand[]
    },
  ): Promise<CanvasDetail> {
    const loaded = await this.findRecordById(input.id)
    if (!loaded) {
      throw new Error('Canvas not found.')
    }

    this.assertWritable(loaded.record, principal)

    const now = new Date().toISOString()
    const editorState = input.editorState as AppState
    const normalizedCommands =
      Array.isArray(input.commands) && input.commands.length > 0
        ? input.commands.map((command) => ({
            ...command,
            actorId: principal.userId,
          }))
        : null

    const projection = normalizedCommands
      ? (() => {
          const applied = applyCanvasCommands(loaded.record.document, normalizedCommands)
          return {
            document: applied.document,
            commands: normalizedCommands,
            events: applied.events,
          }
        })()
      : projectEditorStateThroughCommands({
          previousDocument: loaded.record.document,
          editorState,
          documentId: loaded.record.document.id,
          documentName: loaded.record.storageKey,
          createdAt: loaded.record.document.createdAt,
          updatedAt: now,
          actorId: principal.userId,
        })

    const authorization = filterCanvasCommandsByAccess({
      access: resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.document.id),
      previousDocument: loaded.record.document,
      commands: projection.commands,
    })

    if (authorization.rejectedCommands.length > 0) {
      throw new Error('Some changes are outside the areas you can edit.')
    }

    const nextRecord: StoredCanvasRecord = {
      ...loaded.record,
      revision: loaded.record.revision + 1,
      updatedAt: now,
      editorState,
      document: projection.document,
      commands: [...loaded.record.commands, ...projection.commands],
      events: [...loaded.record.events, ...projection.events],
      sharePolicy: {
        ...input.sharePolicy,
        ownerUserId: loaded.ownerUserId,
        ownerEmail: loaded.record.ownerEmail,
        updatedAt: now,
      },
    }

    await this.persistRecord(nextRecord)
    return this.toDetail(
      {
        ownerUserId: loaded.ownerUserId,
        record: nextRecord,
        sizeBytes: Buffer.byteLength(JSON.stringify(nextRecord)),
      },
      principal,
    )
  }

  async renameById(
    ownerUserId: string,
    input: {
      id: string
      newStorageKey?: string
      title?: string
      ifMatchEtag?: string
    },
  ): Promise<CanvasDetail> {
    const loaded = await this.findRecordById(input.id)
    if (!loaded || loaded.ownerUserId !== ownerUserId) {
      throw new Error('Canvas not found.')
    }

    const currentEtag = hashRecord(loaded.record)
    if (input.ifMatchEtag && input.ifMatchEtag !== currentEtag) {
      throw new Error('Canvas has changed since it was opened.')
    }

    const currentStorageKey = loaded.record.storageKey
    const nextStorageKey = input.newStorageKey ? normalizeStorageKey(input.newStorageKey) : currentStorageKey
    const existingAtNextStorageKey =
      nextStorageKey !== currentStorageKey
        ? await this.getOwnedByStorageKey(ownerUserId, nextStorageKey)
        : null
    if (existingAtNextStorageKey) {
      throw new Error('A canvas already exists at the new storage key.')
    }

    const now = new Date().toISOString()
    const nextRecord: StoredCanvasRecord = {
      ...loaded.record,
      storageKey: nextStorageKey,
      title: input.title?.trim() || loaded.record.title,
      revision: loaded.record.revision + 1,
      updatedAt: now,
      document: {
        ...loaded.record.document,
        updatedAt: now,
        metadata: {
          ...(loaded.record.document.metadata ?? {}),
          documentName: nextStorageKey,
        },
      },
      sharePolicy: {
        ...loaded.record.sharePolicy,
        updatedAt: now,
      },
    }

    await this.persistRecord(nextRecord)

    return this.toDetail(
      {
        ownerUserId,
        record: nextRecord,
        sizeBytes: Buffer.byteLength(JSON.stringify(nextRecord)),
      },
      { userId: ownerUserId, email: nextRecord.ownerEmail },
    )
  }

  async deleteById(ownerUserId: string, id: string): Promise<void> {
    await this.ensureReady()
    const result = await canvasciiPgPool.query(
      `
        DELETE FROM canvases
        WHERE owner_user_id = $1
          AND id = $2
      `,
      [ownerUserId, id],
    )
    if (!result.rowCount) {
      throw new Error('Canvas not found.')
    }
  }

  async getSharePolicy(ownerUserId: string, id: string): Promise<CanvasSharePolicy | null> {
    const loaded = await this.findRecordById(id)
    if (!loaded || loaded.ownerUserId !== ownerUserId) return null
    return loaded.record.sharePolicy
  }

  async saveSharePolicy(
    ownerUserId: string,
    id: string,
    nextSharePolicy: CanvasSharePolicy,
  ): Promise<CanvasShareDetail> {
    const loaded = await this.readShareRecordById(id)
    if (!loaded || loaded.ownerUserId !== ownerUserId) {
      throw new Error('Canvas not found.')
    }

    const now = new Date().toISOString()
    const nextRecord = {
      ...loaded.record,
      sharePolicy: {
        ...nextSharePolicy,
        ownerUserId,
        ownerEmail: loaded.record.ownerEmail,
        updatedAt: now,
      },
      revision: loaded.record.revision + 1,
      updatedAt: now,
    }

    await this.persistSharePolicyOnly({
      id: nextRecord.id,
      revision: nextRecord.revision,
      updatedAt: nextRecord.updatedAt,
      sharePolicy: nextRecord.sharePolicy,
    })
    return this.toLightShareDetail({ ownerUserId, record: nextRecord }, { userId: ownerUserId, email: loaded.record.ownerEmail })
  }

  async saveAccessibleSharePolicy(
    principal: CanvasAccessPrincipal,
    id: string,
    nextSharePolicy: CanvasSharePolicy,
  ): Promise<CanvasShareDetail> {
    const loaded = await this.readShareRecordById(id)
    if (!loaded) {
      throw new Error('Canvas not found.')
    }

    const accessSummary = resolveCanvasAccess(loaded.record.sharePolicy, principal, loaded.record.documentId)
    if (!accessSummary.canEditSomewhere) {
      throw new Error('You only have view access to this canvas.')
    }

    const now = new Date().toISOString()
    const nextRecord = {
      ...loaded.record,
      sharePolicy: {
        ...nextSharePolicy,
        ownerUserId: loaded.ownerUserId,
        ownerEmail: loaded.record.ownerEmail,
        updatedAt: now,
      },
      revision: loaded.record.revision + 1,
      updatedAt: now,
    }

    await this.persistSharePolicyOnly({
      id: nextRecord.id,
      revision: nextRecord.revision,
      updatedAt: nextRecord.updatedAt,
      sharePolicy: nextRecord.sharePolicy,
    })
    return this.toLightShareDetail({ ownerUserId: loaded.ownerUserId, record: nextRecord }, principal)
  }

  async resolveCollabAccess(principal: CanvasAccessPrincipal, id: string) {
    const loaded = await this.findRecordById(id)
    if (!loaded) {
      throw new Error('Canvas not found.')
    }

    const accessSummary = this.assertReadable(loaded.record, principal)
    return {
      fileId: loaded.record.id,
      canvasId: loaded.record.id,
      documentId: loaded.record.document.id,
      ownerUserId: loaded.ownerUserId,
      ownerEmail: loaded.record.ownerEmail,
      title: loaded.record.title,
      storageKey: loaded.record.storageKey,
      accessSummary,
      sharePolicy: loaded.record.sharePolicy,
    }
  }
}
