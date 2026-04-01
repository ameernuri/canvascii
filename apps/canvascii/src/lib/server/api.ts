import { NextResponse } from 'next/server'

export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    init,
  )
}

export function apiError(status: number, message: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        message,
      },
    },
    { status },
  )
}
