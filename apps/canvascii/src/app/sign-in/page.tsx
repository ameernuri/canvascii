'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center p-6 text-sm text-slate-600">Loading...</div>}>
      <SignInPageContent />
    </Suspense>
  )
}

function SignInPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading, signInEmail, signUpEmail } = useAuth()

  const nextPath = useMemo(() => {
    const next = searchParams.get('next') || '/'
    return next.startsWith('/') ? next : '/'
  }, [searchParams])

  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(nextPath)
    }
  }, [isAuthenticated, isLoading, nextPath, router])

  async function onSubmit() {
    setSubmitting(true)
    setError(null)

    try {
      if (!email || !password) throw new Error('Email and password are required.')

      if (mode === 'sign_in') {
        await signInEmail({ email, password })
      } else {
        const normalizedFirstName = firstName.trim()
        const normalizedLastName = lastName.trim()
        if (!normalizedFirstName || !normalizedLastName) {
          throw new Error('First and last name are required.')
        }
        await signUpEmail({
          email,
          password,
          name: `${normalizedFirstName} ${normalizedLastName}`.trim(),
        })
      }

      router.replace(nextPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-slate-600">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="mx-auto grid min-h-screen w-full max-w-7xl items-start gap-10 px-6 py-12 md:px-10 md:py-16 lg:grid-cols-[1.1fr_480px]">
        <section className="space-y-6 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Canvascii</p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.04] tracking-tight text-slate-900 md:text-6xl">
            Draw first.
            <br />
            Save when it matters.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-slate-600">
            Open the canvas immediately. Sign in only when you want to keep, reopen, or share your diagrams.
          </p>
          <div className="text-sm text-slate-600">
            Back to canvas:{' '}
            <Link href={nextPath} className="font-medium text-slate-900 underline-offset-4 hover:underline">
              {nextPath}
            </Link>
          </div>
        </section>

        <Card className="w-full border-slate-200 bg-white shadow-xs">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl text-slate-900">{mode === 'sign_in' ? 'Sign in' : 'Create account'}</CardTitle>
            <CardDescription className="text-slate-600">
              {mode === 'sign_in'
                ? 'Use your existing account to save and reopen canvases.'
                : 'Create an account to start saving canvases.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void onSubmit()
              }}
            >
              {mode === 'sign_up' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="firstName" className="text-sm font-medium text-slate-800">First name</label>
                    <input
                      id="firstName"
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-hidden"
                      type="text"
                      placeholder="Sarah"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="lastName" className="text-sm font-medium text-slate-800">Last name</label>
                    <input
                      id="lastName"
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-hidden"
                      type="text"
                      placeholder="Lee"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium text-slate-800">Email</label>
                <input
                  id="email"
                  className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-hidden"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-slate-800">Password</label>
                <input
                  id="password"
                  className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-500 focus:outline-hidden"
                  type="password"
                  placeholder="••••••••"
                  autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              ) : null}

              <Button type="submit" className="h-11 w-full" disabled={submitting}>
                {submitting ? 'Working...' : mode === 'sign_in' ? 'Sign in' : 'Create account'}
              </Button>

              <div className="text-sm text-slate-600">
                {mode === 'sign_in' ? (
                  <>
                    Need an account?{' '}
                    <button type="button" className="font-medium text-slate-900 underline-offset-4 hover:underline" onClick={() => setMode('sign_up')}>
                      Create one
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button type="button" className="font-medium text-slate-900 underline-offset-4 hover:underline" onClick={() => setMode('sign_in')}>
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
