import { apiError, apiSuccess } from '@/lib/server/api'
import { resolveAuthSession } from '@/lib/server/auth'
import {
  extractCanvasShareToken,
  getReadableCanvasDetail,
  toShareTokenPrincipal,
} from '@/lib/server/canvas-access'
import { CanvasLibraryStore } from '@/lib/server/canvas-library-store'

export const runtime = 'nodejs'

const store = new CanvasLibraryStore()

export async function GET(request: Request) {
  const session = await resolveAuthSession(request)
  const shareToken = extractCanvasShareToken(request)
  if (!session && !shareToken) {
    return apiError(401, 'Authentication required.')
  }

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return apiError(400, 'Canvas id is required.')
  }

  try {
    const resolved = await getReadableCanvasDetail(store, {
      id,
      session,
      shareToken,
    })
    if (!resolved.detail || !resolved.principal) {
      return apiError(404, 'Canvas not found.')
    }

    const access = await store.resolveCollabAccess(resolved.principal, id)

    const isShareLinkPrincipal = Boolean(shareToken && resolved.principal.shareToken === shareToken)

    return apiSuccess({
      ...access,
      user: {
        id: isShareLinkPrincipal ? resolved.principal.userId : session!.user.id,
        email: isShareLinkPrincipal ? null : session!.user.email ?? null,
        name: isShareLinkPrincipal ? 'Shared link' : session!.user.name ?? null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve collaboration access.'
    return apiError(message.includes('not found') ? 404 : 403, message)
  }
}
