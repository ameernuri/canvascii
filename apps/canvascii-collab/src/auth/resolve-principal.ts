import { canvasciiPrincipalSchema, type CanvasAccessSummary, type CanvasciiPrincipal } from '@canvascii/core'
import { collabConfig } from '../config'

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

function assertTrustedOrigin(originHeader: string | undefined): void {
  if (!originHeader) return
  const normalized = normalizeOrigin(originHeader)
  if (!collabConfig.trustedOrigins.map(normalizeOrigin).includes(normalized)) {
    throw new Error(`Untrusted websocket origin: ${originHeader}`)
  }
}

async function fetchSessionAndAccess(
  documentId: string,
  cookie: string,
): Promise<{
  principal: CanvasciiPrincipal
  access: CanvasAccessSummary
}> {
  const response = await fetch(`${collabConfig.apiOrigin}/api/v1/canvascii/collab-access?id=${encodeURIComponent(documentId)}`, {
    method: 'GET',
    headers: {
      cookie,
      accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Canvascii collaboration requires canvas access.')
  }

  const payload = (await response.json()) as {
    data?: {
      user?: { id?: string; email?: string | null; name?: string | null; role?: string | null }
      accessSummary?: CanvasAccessSummary
    }
  }

  return {
    principal: canvasciiPrincipalSchema.parse({
      userId: payload.data?.user?.id,
      actorId: payload.data?.user?.id ? `human:${payload.data.user.id}` : undefined,
      actorType: 'human',
      sessionId: null,
      email: payload.data?.user?.email ?? null,
      name: payload.data?.user?.name ?? null,
      role: payload.data?.user?.role ?? null,
      source: 'better-auth',
    }),
    access: payload.data?.accessSummary as CanvasAccessSummary,
  }
}

async function fetchLinkAccess(
  documentId: string,
  shareToken: string,
): Promise<{
  principal: CanvasciiPrincipal
  access: CanvasAccessSummary
}> {
  const response = await fetch(`${collabConfig.apiOrigin}/api/v1/canvascii/collab-access?id=${encodeURIComponent(documentId)}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-canvascii-share-token': shareToken,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Canvascii collaboration requires canvas access.')
  }

  const payload = (await response.json()) as {
    data?: {
      user?: { id?: string; email?: string | null; name?: string | null; role?: string | null }
      accessSummary?: CanvasAccessSummary
    }
  }

  return {
    principal: canvasciiPrincipalSchema.parse({
      userId: payload.data?.user?.id,
      actorId: shareToken ? `link:${shareToken}` : undefined,
      actorType: 'human',
      sessionId: null,
      email: payload.data?.user?.email ?? null,
      name: payload.data?.user?.name ?? null,
      role: payload.data?.user?.role ?? null,
      source: 'share-link',
    }),
    access: payload.data?.accessSummary as CanvasAccessSummary,
  }
}

export async function resolvePrincipalFromHeaders(
  documentId: string,
  headers: Headers | Record<string, string | string[] | undefined>,
  authToken?: string | null,
): Promise<{
  principal: CanvasciiPrincipal
  access: CanvasAccessSummary
}> {
  const getHeader = (name: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(name) ?? undefined
    const value = headers[name.toLowerCase()] ?? headers[name]
    if (Array.isArray(value)) return value[0]
    return value
  }

  assertTrustedOrigin(getHeader('origin'))

  const cookie = getHeader('cookie')
  if (cookie) {
    try {
      return await fetchSessionAndAccess(documentId, cookie)
    } catch {
      // Fall through to optional dev bypass.
    }
  }

  if (authToken?.startsWith('share:')) {
    try {
      return await fetchLinkAccess(documentId, authToken.slice('share:'.length))
    } catch {
      // Fall through to optional dev bypass.
    }
  }

  if (collabConfig.allowDevAuthBypass) {
    return {
      principal: canvasciiPrincipalSchema.parse({
        userId: collabConfig.devBypassUserId,
        actorId: `system:${collabConfig.devBypassUserId}`,
        actorType: 'system',
        sessionId: null,
        email: null,
        name: 'Canvascii Dev Bypass',
        role: 'developer',
        source: 'dev-bypass',
      }),
      access: {
        documentId,
        rootAccess: 'owner',
        canRead: true,
        canEditSomewhere: true,
        canEditAnywhere: true,
        portals: [],
      },
    }
  }

  throw new Error('Canvascii collaboration requires a valid Better Auth session.')
}
