import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { homePath, useMe } from './session'
import type { AccountType } from './types'
export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-slate-400" aria-label="Loading" />
    </div>
  )
}

/** Inline spinner for a page that is still loading (inside the portal layout). */
export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-slate-400" aria-label="Loading" />
    </div>
  )
}

/** Renders children only for a signed-in user (optionally of one account type). */
export function RequireAuth({ accountType, children }: { accountType?: AccountType; children: ReactNode }) {
  const { data: me, error, isPending } = useMe()
  if (isPending) return <FullPageSpinner />
  if (error) {
    if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />
    return <p className="p-8 text-center text-sm text-red-600">{error.message}</p>
  }
  if (accountType && me.accountType !== accountType) return <Navigate to="/app" replace />
  return children
}

export function HomeRedirect() {
  const { data: me, error, isPending } = useMe()
  if (isPending) return <FullPageSpinner />
  if (error || !me) return <Navigate to="/login" replace />
  return <Navigate to={homePath(me)} replace />
}
