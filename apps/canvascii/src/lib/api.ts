/**
 * Builds API URLs used by Canvascii client components.
 *
 * Default behavior:
 * - Uses same-origin paths so Next.js rewrites proxy requests to the API.
 *
 * Optional override:
 * - `NEXT_PUBLIC_CANVASCII_API_PREFIX`
 */
const apiPrefix = (
  process.env.NEXT_PUBLIC_CANVASCII_API_PREFIX ??
  ''
).replace(/\/+$/, '')

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${apiPrefix}${normalizedPath}`
}
