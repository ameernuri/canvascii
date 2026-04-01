import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { canvasciiServerEnv } from './env'
import { canvasciiPgPool } from './pg'

export const auth = betterAuth({
  database: canvasciiPgPool,
  secret: canvasciiServerEnv.BETTER_AUTH_SECRET,
  baseURL: canvasciiServerEnv.BETTER_AUTH_URL,
  trustedOrigins: canvasciiServerEnv.BETTER_AUTH_TRUSTED_ORIGINS,
  advanced: {
    // Keep Canvascii auth isolated from other localhost Better Auth apps.
    cookiePrefix: canvasciiServerEnv.BETTER_AUTH_COOKIE_PREFIX,
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [nextCookies()],
})

export type CanvasciiAuthSession = {
  user: {
    id: string
    email: string | null
    name: string | null
    role: string | null
  }
  session: {
    id: string
  }
}

export async function resolveAuthSession(request: Request): Promise<CanvasciiAuthSession | null> {
  const result = await auth.api.getSession({
    headers: request.headers,
  })

  if (!result?.user?.id || !result?.session?.id) {
    return null
  }

  return {
    user: {
      id: result.user.id,
      email: result.user.email ?? null,
      name: result.user.name ?? null,
      role: null,
    },
    session: {
      id: result.session.id,
    },
  }
}
