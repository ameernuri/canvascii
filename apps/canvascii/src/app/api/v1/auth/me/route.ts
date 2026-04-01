import { apiError, apiSuccess } from '@/lib/server/api'
import { resolveAuthSession } from '@/lib/server/auth'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const session = await resolveAuthSession(request)
  if (!session) {
    return apiError(401, 'Authentication required.')
  }

  return apiSuccess({
    user: session.user,
    session: session.session,
  })
}
