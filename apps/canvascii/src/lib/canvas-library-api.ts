import type { CanvasAccessSummary, CanvasCommand, CanvasSharePolicy } from '@canvascii/core'
import { requestEnvelopedApi } from '@/lib/enveloped-api'

const fetchApi = requestEnvelopedApi

export type CanvasSummary = {
  id: string
  /** Canonical opaque database storage key. */
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

export type CanvasListResult = {
  /** Canonical storage-root alias; not a filesystem path. */
  rootStorageKey: string | null
  canvases: CanvasSummary[]
}

export type CanvasShareResult = {
  id: string
  ownerUserId: string
  sharePolicy: CanvasSharePolicy
  accessSummary: CanvasAccessSummary
}

export const canvasLibraryApi = {
  listCanvases: async (params?: { query?: string; directory?: string; limit?: number }) => {
    const search = new URLSearchParams()
    if (params?.query) search.set('query', params.query)
    if (params?.directory) search.set('directory', params.directory)
    if (params?.limit) search.set('limit', String(params.limit))
    const result = await fetchApi<CanvasListResult>(`/api/v1/canvascii/canvases${search.size ? `?${search.toString()}` : ''}`)
    return {
      rootStorageKey: result.rootStorageKey,
      canvases: result.canvases,
    } satisfies CanvasListResult
  },
  getCanvas: (input: { storageKey?: string; id?: string }) => {
    const search = new URLSearchParams()
    if (input.storageKey) search.set('storageKey', input.storageKey)
    if (input.id) search.set('id', input.id)
    return fetchApi<CanvasDetail>(`/api/v1/canvascii/canvas?${search.toString()}`)
  },
  createCanvas: (input: {
    storageKey?: string
    name?: string
    directory?: string
    title?: string
    editorState?: Record<string, unknown>
    commands?: CanvasCommand[]
    overwrite?: boolean
  }) =>
    fetchApi<CanvasDetail>('/api/v1/canvascii/canvas', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCanvas: (input: {
    id?: string
    storageKey?: string
    editorState: Record<string, unknown>
    commands?: CanvasCommand[]
    ifMatchEtag?: string
    changeType?: 'autosave' | 'commit'
  }) =>
    fetchApi<CanvasDetail>('/api/v1/canvascii/canvas', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  renameCanvas: (input: {
    id: string
    newStorageKey?: string
    title?: string
    ifMatchEtag?: string
  }) =>
    fetchApi<CanvasDetail>('/api/v1/canvascii/canvas', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCanvas: (id: string) =>
    fetchApi<{ deleted: true; id: string }>(`/api/v1/canvascii/canvas?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getCanvasShare: (id: string) => fetchApi<CanvasShareResult>(`/api/v1/canvascii/share?id=${encodeURIComponent(id)}`),
  updateCanvasShare: (input: { id: string; sharePolicy: CanvasSharePolicy }) =>
    fetchApi<CanvasShareDetail>('/api/v1/canvascii/share', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  applyAgentAction: (input: {
    id: string
    action: Record<string, unknown>
    editorState?: Record<string, unknown>
  }) =>
    fetchApi<CanvasDetail>('/api/v1/canvascii/agent', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  applyAgentShareAction: (input: {
    id: string
    action: Record<string, unknown>
    editorState?: Record<string, unknown>
  }) =>
    fetchApi<CanvasShareDetail>('/api/v1/canvascii/agent', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        responseMode: 'share-only',
      }),
    }),
}
