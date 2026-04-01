import type { CanvasSharePolicy } from '@canvascii/core'
import { apiError, apiSuccess } from '@/lib/server/api'
import { resolveAuthSession } from '@/lib/server/auth'
import { CanvasLibraryStore } from '@/lib/server/canvas-library-store'

export const runtime = 'nodejs'

const store = new CanvasLibraryStore()

export async function GET(request: Request) {
  const session = await resolveAuthSession(request)
  if (!session) {
    return apiError(401, 'Authentication required.')
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return apiError(400, 'Canvas id is required.')
  }

  const detail = await store.getAccessibleById(
    {
      userId: session.user.id,
      email: session.user.email ?? null,
    },
    id,
  )

  if (!detail) {
    return apiError(404, 'Canvas not found.')
  }

  return apiSuccess({
    id: detail.id,
    ownerUserId: detail.ownerUserId,
    sharePolicy: detail.sharePolicy,
    accessSummary: detail.accessSummary,
  })
}

export async function PATCH(request: Request) {
  const session = await resolveAuthSession(request)
  if (!session) {
    return apiError(401, 'Authentication required.')
  }

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string
        sharePolicy?: CanvasSharePolicy
      }
    | null

  if (!body?.id || !body.sharePolicy) {
    return apiError(400, 'Canvas id and share policy are required.')
  }

  try {
    const detail = await store.saveSharePolicy(session.user.id, body.id, body.sharePolicy)
    return apiSuccess(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update sharing.'
    return apiError(message.includes('not found') ? 404 : 403, message)
  }
}
