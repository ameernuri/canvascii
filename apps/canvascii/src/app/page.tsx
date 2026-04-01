import { Suspense } from 'react'
import { CanvasciiPage } from '@/components/canvascii/canvascii-page'

export const dynamic = 'force-dynamic'

export default function CanvasciiHomePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading Canvascii...</div>}>
      <CanvasciiPage />
    </Suspense>
  )
}
