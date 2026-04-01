import {
  CANVASCII_SHARE_TOKEN_HEADER,
  CANVASCII_SHARE_TOKEN_QUERY_PARAM,
} from '@canvascii/core'

export { CANVASCII_SHARE_TOKEN_HEADER, CANVASCII_SHARE_TOKEN_QUERY_PARAM }

export function getActiveCanvasShareToken(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const token = params.get(CANVASCII_SHARE_TOKEN_QUERY_PARAM)?.trim()
  return token || null
}

export function withCanvasShareTokenHeaders(headers?: HeadersInit): HeadersInit {
  const token = getActiveCanvasShareToken()
  if (!token) return headers ?? {}

  const next = new Headers(headers ?? {})
  next.set(CANVASCII_SHARE_TOKEN_HEADER, token)
  return next
}

export function buildCanvasShareUrl(input: {
  origin: string
  canvasId: string
  token: string
}) {
  const url = new URL(input.origin)
  url.searchParams.set('canvas', input.canvasId)
  url.searchParams.set(CANVASCII_SHARE_TOKEN_QUERY_PARAM, input.token)
  return url.toString()
}
