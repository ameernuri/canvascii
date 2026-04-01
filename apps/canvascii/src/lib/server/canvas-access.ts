import {
  CANVASCII_SHARE_TOKEN_HEADER,
  CANVASCII_SHARE_TOKEN_QUERY_PARAM,
  type CanvasAccessPrincipal,
} from '@canvascii/core'
import type { CanvasLibraryStore, CanvasDetail, CanvasShareDetail } from '@/lib/server/canvas-library-store'
import type { CanvasciiAuthSession } from '@/lib/server/auth'

export function extractCanvasShareToken(request: Request): string | null {
  const headerToken = request.headers.get(CANVASCII_SHARE_TOKEN_HEADER)?.trim()
  if (headerToken) return headerToken
  const url = new URL(request.url)
  return url.searchParams.get(CANVASCII_SHARE_TOKEN_QUERY_PARAM)?.trim() || null
}

export function toShareTokenPrincipal(token: string): CanvasAccessPrincipal {
  return {
    userId: `link:${token}`,
    email: null,
    shareToken: token,
  }
}

export function toSessionPrincipal(session: CanvasciiAuthSession): CanvasAccessPrincipal {
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
  }
}

export async function getReadableCanvasDetail(
  store: CanvasLibraryStore,
  input: {
    id: string
    session: CanvasciiAuthSession | null
    shareToken?: string | null
  },
): Promise<{ detail: CanvasDetail | null; principal: CanvasAccessPrincipal | null }> {
  if (input.session) {
    const principal = toSessionPrincipal(input.session)
    const detail = await store.getAccessibleById(principal, input.id)
    if (detail) return { detail, principal }
  }

  if (input.shareToken) {
    const principal = toShareTokenPrincipal(input.shareToken)
    const detail = await store.getAccessibleById(principal, input.id)
    if (detail) return { detail, principal }
  }

  return { detail: null, principal: null }
}

export async function getWritableCanvasDetail(
  store: CanvasLibraryStore,
  input: {
    id: string
    session: CanvasciiAuthSession | null
    shareToken?: string | null
  },
): Promise<{ detail: CanvasDetail | null; principal: CanvasAccessPrincipal | null }> {
  if (input.session) {
    const principal = toSessionPrincipal(input.session)
    const detail = await store.getAccessibleById(principal, input.id)
    if (detail?.accessSummary.canEditSomewhere) return { detail, principal }
  }

  if (input.shareToken) {
    const principal = toShareTokenPrincipal(input.shareToken)
    const detail = await store.getAccessibleById(principal, input.id)
    if (detail?.accessSummary.canEditSomewhere) return { detail, principal }
  }

  return { detail: null, principal: null }
}

export async function getWritableCanvasShare(
  store: CanvasLibraryStore,
  input: {
    id: string
    session: CanvasciiAuthSession | null
    shareToken?: string | null
  },
): Promise<{ detail: CanvasShareDetail | null; principal: CanvasAccessPrincipal | null }> {
  if (input.session) {
    const principal = toSessionPrincipal(input.session)
    const detail = await store.getAccessibleShareById(principal, input.id)
    if (detail?.accessSummary.canEditSomewhere) return { detail, principal }
  }

  if (input.shareToken) {
    const principal = toShareTokenPrincipal(input.shareToken)
    const detail = await store.getAccessibleShareById(principal, input.id)
    if (detail?.accessSummary.canEditSomewhere) return { detail, principal }
  }

  return { detail: null, principal: null }
}
