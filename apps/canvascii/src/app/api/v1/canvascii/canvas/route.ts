import { apiError, apiSuccess } from '@/lib/server/api'
import { resolveAuthSession } from '@/lib/server/auth'
import {
  extractCanvasShareToken,
  getReadableCanvasDetail,
  getWritableCanvasDetail,
} from '@/lib/server/canvas-access'
import { CanvasLibraryStore } from '@/lib/server/canvas-library-store'
import type { CanvasCommand } from '@canvascii/core'

export const runtime = 'nodejs'

const store = new CanvasLibraryStore()

function getErrorStatus(message: string) {
  if (message.includes('not found')) return 404
  if (message.includes('already exists')) return 409
  if (message.includes('changed since it was opened')) return 412
  if (message.includes('outside the areas you can edit')) return 403
  if (message.includes('view access')) return 403
  if (message.includes('Invalid canvas storage key')) return 400
  if (message.includes('required')) return 400
  return 500
}

export async function GET(request: Request) {
  const session = await resolveAuthSession(request)
  const shareToken = extractCanvasShareToken(request)
  if (!session && !shareToken) {
    return apiError(401, 'Authentication required.')
  }

  const url = new URL(request.url)
  const canvasId = url.searchParams.get('id')
  const storageKey = url.searchParams.get('storageKey')

  if (!canvasId && !storageKey) {
    return apiError(400, 'Canvas storage key or id is required.')
  }

  const detail = canvasId
    ? (await getReadableCanvasDetail(store, {
        id: canvasId,
        session,
        shareToken,
      })).detail
    : session
      ? await store.getOwned(session.user.id, storageKey as string)
      : null
  if (!detail) {
    return apiError(storageKey && !session ? 401 : 404, storageKey && !session ? 'Authentication required.' : 'Canvas not found.')
  }

  return apiSuccess(detail)
}

export async function POST(request: Request) {
  const session = await resolveAuthSession(request)
  if (!session) {
    return apiError(401, 'Authentication required.')
  }

  const body = (await request.json().catch(() => null)) as
    | {
        storageKey?: string
        name?: string
        directory?: string
        title?: string
        editorState?: Record<string, unknown>
        commands?: CanvasCommand[]
        overwrite?: boolean
      }
    | null

  if (!body) {
    return apiError(400, 'Canvas payload is required.')
  }

  try {
    const detail = await store.create(session.user.id, {
      ...body,
      ownerEmail: session.user.email ?? null,
    })
    return apiSuccess(detail, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create canvas.'
    return apiError(getErrorStatus(message), message)
  }
}

export async function PUT(request: Request) {
  const session = await resolveAuthSession(request)
  const shareToken = extractCanvasShareToken(request)
  if (!session && !shareToken) {
    return apiError(401, 'Authentication required.')
  }

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string
        storageKey?: string
        editorState?: Record<string, unknown>
        commands?: CanvasCommand[]
        ifMatchEtag?: string
      }
    | null

  if ((!body?.storageKey && !body?.id) || !body.editorState) {
    return apiError(400, 'Canvas id or storage key and editor state are required.')
  }

  try {
    const resolved =
      body.id
        ? await getWritableCanvasDetail(store, {
            id: body.id,
            session,
            shareToken,
          })
        : null

    if (body.id && (!resolved || !resolved.detail || !resolved.principal)) {
      return apiError(403, 'You only have view access to this canvas.')
    }

    if (body.storageKey && !session) {
      return apiError(401, 'Authentication required.')
    }

    const detail = await store.updateAccessible(
      body.id && resolved?.principal
        ? resolved.principal
        : {
            userId: session!.user.id,
            email: session!.user.email ?? null,
          },
      {
        id: body.id,
        storageKey: body.storageKey,
        editorState: body.editorState,
        commands: body.commands,
        ifMatchEtag: body.ifMatchEtag,
      },
    )
    return apiSuccess(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update canvas.'
    return apiError(getErrorStatus(message), message)
  }
}

export async function PATCH(request: Request) {
  const session = await resolveAuthSession(request)
  if (!session) {
    return apiError(401, 'Authentication required.')
  }

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string
        newStorageKey?: string
        title?: string
        ifMatchEtag?: string
      }
    | null

  if (!body?.id) {
    return apiError(400, 'Canvas id is required.')
  }

  try {
    const detail = await store.renameById(session.user.id, {
      id: body.id,
      newStorageKey: body.newStorageKey,
      title: body.title,
      ifMatchEtag: body.ifMatchEtag,
    })
    return apiSuccess(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to rename canvas.'
    return apiError(getErrorStatus(message), message)
  }
}

export async function DELETE(request: Request) {
  const session = await resolveAuthSession(request)
  if (!session) {
    return apiError(401, 'Authentication required.')
  }

  const url = new URL(request.url)
  const canvasId = url.searchParams.get('id')
  if (!canvasId) {
    return apiError(400, 'Canvas id is required.')
  }

  try {
    await store.deleteById(session.user.id, canvasId)
    return apiSuccess({
      deleted: true,
      id: canvasId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete canvas.'
    return apiError(getErrorStatus(message), message)
  }
}
