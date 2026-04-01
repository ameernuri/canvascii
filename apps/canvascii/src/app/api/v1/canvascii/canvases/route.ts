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
  const query = url.searchParams.get('query') ?? undefined
  const directory = url.searchParams.get('directory') ?? undefined
  const limit = url.searchParams.get('limit')

  const result = await store.listAccessible(
    {
      userId: session.user.id,
      email: session.user.email ?? null,
    },
    {
      query,
      directory,
      limit: limit ? Number(limit) : undefined,
    },
  )

  return apiSuccess(result)
}
