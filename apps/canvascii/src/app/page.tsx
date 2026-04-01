import dynamic from 'next/dynamic'

const CanvasciiPage = dynamic(
  () => import('@/components/canvascii/canvascii-page').then((module) => module.CanvasciiPage),
  {
    loading: () => (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading Canvascii...
      </div>
    ),
  },
)

export default function CanvasciiHomePage() {
  return <CanvasciiPage />
}
