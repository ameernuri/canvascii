'use client'

import { apiUrl } from '@/lib/api'
import { withCanvasShareTokenHeaders } from '@/lib/canvas-share-token'
import { unwrapEnvelopedData } from '@/lib/enveloped-api'

export type AuthUser = {
  id: string
  email?: string | null
  name?: string | null
  role?: string | null
}

export type AuthSession = {
  id: string
}

export type SessionPayload = {
  user: AuthUser
  session: AuthSession
} | null

export type SignInInput = {
  email: string
  password: string
}

export type SignUpInput = {
  email: string
  password: string
  name?: string
}

export type AuthContextPayload = {
  user: AuthUser
  session: AuthSession
}

type JsonLike = Record<string, unknown>

class ApiRequestError extends Error {
  status: number
  payload: unknown

  constructor(status: number, message: string, payload: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.payload = payload
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as JsonLike
  const message = record.message
  if (typeof message === 'string' && message.trim().length > 0) return message

  const error = record.error
  if (error && typeof error === 'object') {
    const errorMessage = (error as JsonLike).message
    if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) return errorMessage
  }

  return null
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(withCanvasShareTokenHeaders(init?.headers)).entries()),
    },
  })

  const rawText = await response.text().catch(() => '')
  let payload: unknown = null
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const fallback =
      response.status >= 500
        ? `Server error (HTTP ${response.status}). Check Canvascii app logs and DATABASE_URL connectivity.`
        : `Request failed with HTTP ${response.status}`
    const message = extractErrorMessage(payload) || rawText.trim() || fallback
    throw new ApiRequestError(response.status, message, payload)
  }

  return payload
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const authClient = {
  async waitForSession(attempts = 6, delayMs = 120): Promise<SessionPayload> {
    for (let i = 0; i < attempts; i += 1) {
      const payload = await this.getSession().catch(() => null)
      if (payload?.user?.id && payload?.session?.id) return payload
      if (i < attempts - 1) await delay(delayMs)
    }
    return null
  },

  async getSession(): Promise<SessionPayload> {
    const payload = await requestJson('/api/auth/get-session', { method: 'GET' })
    if (!payload || typeof payload !== 'object') return null

    const record = payload as JsonLike
    const user = record.user
    const session = record.session
    if (!user || !session || typeof user !== 'object' || typeof session !== 'object') return null

    return {
      user: user as AuthUser,
      session: session as AuthSession,
    }
  },

  async signInEmail(input: SignInInput): Promise<void> {
    await requestJson('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    const session = await this.waitForSession()
    if (!session) {
      throw new Error('Sign-in succeeded but no session was established yet. Please retry.')
    }
  },

  async signUpEmail(input: SignUpInput): Promise<void> {
    await requestJson('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    const session = await this.waitForSession()
    if (!session) {
      throw new Error('Account created but no session was established yet. Please retry.')
    }
  },

  async signOut(): Promise<void> {
    await requestJson('/api/auth/sign-out', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  async getAuthContext(): Promise<AuthContextPayload> {
    return unwrapEnvelopedData<AuthContextPayload>(await requestJson('/api/v1/auth/me'))
  },
}
