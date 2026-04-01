import { CANVASCII_YDOC_DOCUMENT_KEY, CANVASCII_YDOC_ROOT_KEY, type CanvasDocument } from '@canvascii/core'
import * as Y from 'yjs'
import { canvasciiCollabPgPool } from '../db'

export class CanvasciiDocumentStore {
  private documentsPersisted = 0
  private lastPersistedAt: string | null = null

  async ensureReady(): Promise<void> {
    await canvasciiCollabPgPool.query(`
      CREATE TABLE IF NOT EXISTS canvas_document_snapshots (
        document_name text PRIMARY KEY,
        snapshot bytea NOT NULL,
        bytes integer NOT NULL,
        stored_at timestamptz NOT NULL
      )
    `)
  }

  getHealthSummary() {
    return {
      documentsPersisted: this.documentsPersisted,
      lastPersistedAt: this.lastPersistedAt,
      localSnapshotDir: 'postgres://canvas_document_snapshots',
      s3Enabled: false,
      s3Bucket: null,
    }
  }

  async load(documentName: string): Promise<Uint8Array | null> {
    await this.ensureReady()
    const result = await canvasciiCollabPgPool.query<{ snapshot: Buffer }>(
      `
        SELECT snapshot
        FROM canvas_document_snapshots
        WHERE document_name = $1
      `,
      [documentName],
    )

    const snapshot = result.rows[0]?.snapshot
    if (snapshot) {
      const encodedSnapshot = new Uint8Array(snapshot)
      if (this.hasCanonicalCanvasDocument(encodedSnapshot)) {
        return encodedSnapshot
      }
    }

    return this.loadCanonicalCanvasDocument(documentName)
  }

  async store(documentName: string, update: Uint8Array): Promise<void> {
    await this.ensureReady()

    const storedAt = new Date().toISOString()
    await canvasciiCollabPgPool.query(
      `
        INSERT INTO canvas_document_snapshots (document_name, snapshot, bytes, stored_at)
        VALUES ($1, $2, $3, $4::timestamptz)
        ON CONFLICT (document_name) DO UPDATE SET
          snapshot = EXCLUDED.snapshot,
          bytes = EXCLUDED.bytes,
          stored_at = EXCLUDED.stored_at
      `,
      [documentName, Buffer.from(update), update.byteLength, storedAt],
    )

    this.documentsPersisted += 1
    this.lastPersistedAt = storedAt
  }

  private normalizeCanvasId(documentName: string): string {
    return documentName.startsWith('canvascii:') ? documentName.slice('canvascii:'.length) : documentName
  }

  private encodeCanvasDocumentSnapshot(document: CanvasDocument): Uint8Array {
    const ydoc = new Y.Doc()
    const root = ydoc.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
    root.set(CANVASCII_YDOC_DOCUMENT_KEY, document)
    return Y.encodeStateAsUpdate(ydoc)
  }

  private hasCanonicalCanvasDocument(update: Uint8Array): boolean {
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, update)
    const root = ydoc.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
    const candidate = root.get(CANVASCII_YDOC_DOCUMENT_KEY)
    return Boolean(candidate && typeof candidate === 'object' && !Array.isArray(candidate))
  }

  private async loadCanonicalCanvasDocument(documentName: string): Promise<Uint8Array | null> {
    const normalizedCanvasId = this.normalizeCanvasId(documentName)
    const result = await canvasciiCollabPgPool.query<{ document: CanvasDocument }>(
      `
        SELECT document
        FROM canvases
        WHERE id = $1 OR document_id = $1
        LIMIT 1
      `,
      [normalizedCanvasId],
    )

    const document = result.rows[0]?.document
    return document ? this.encodeCanvasDocumentSnapshot(document) : null
  }
}
