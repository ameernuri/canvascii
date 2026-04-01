'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  authClient,
  type AuthContextPayload,
  type AuthSession,
  type AuthUser,
  type SessionPayload,
  type SignInInput,
  type SignUpInput,
} from '@/lib/auth-client'
import { getActiveCanvasShareToken } from '@/lib/canvas-share-token'

type AuthContextValue = {
  user: AuthUser | null
  session: AuthSession | null
  isAuthenticated: boolean
  isLoading: boolean
  refreshContext: () => Promise<AuthContextPayload | null>
  refreshSession: () => Promise<SessionPayload>
  signInEmail: (input: SignInInput) => Promise<void>
  signUpEmail: (input: SignUpInput) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const applyAuthContext = useCallback((payload: AuthContextPayload | null) => {
    if (!payload) {
      setUser(null)
      setSession(null)
      return
    }
    setUser(payload.user)
    setSession(payload.session)
  }, [])

  const refreshContext = useCallback(async (): Promise<AuthContextPayload | null> => {
    try {
      const payload = await authClient.getAuthContext()
      applyAuthContext(payload)
      return payload
    } catch {
      applyAuthContext(null)
      return null
    }
  }, [applyAuthContext])

  const refreshSession = useCallback(async (): Promise<SessionPayload> => {
    const payload = await refreshContext()
    if (!payload) return null
    return { user: payload.user, session: payload.session }
  }, [refreshContext])

  const signInEmail = useCallback(
    async (input: SignInInput) => {
      await authClient.signInEmail(input)
      const payload = await refreshSession()
      if (!payload) {
        throw new Error('Signed in, but session context could not be loaded. Please retry.')
      }
    },
    [refreshSession],
  )

  const signUpEmail = useCallback(
    async (input: SignUpInput) => {
      await authClient.signUpEmail(input)
      const payload = await refreshSession()
      if (!payload) {
        throw new Error('Account created, but session context could not be loaded. Please retry.')
      }
    },
    [refreshSession],
  )

  const signOut = useCallback(async () => {
    await authClient.signOut()
    applyAuthContext(null)
  }, [applyAuthContext])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const session = await authClient.getSession().catch(() => null)
        const payload =
          session?.user?.id && session?.session?.id
            ? await authClient.getAuthContext().catch(() => null)
            : getActiveCanvasShareToken()
              ? null
              : null
        if (!cancelled) applyAuthContext(payload)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyAuthContext])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isAuthenticated: Boolean(user?.id && session?.id),
      isLoading,
      refreshContext,
      refreshSession,
      signInEmail,
      signUpEmail,
      signOut,
    }),
    [
      user,
      session,
      isLoading,
      refreshContext,
      refreshSession,
      signInEmail,
      signUpEmail,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.')
  }
  return context
}
