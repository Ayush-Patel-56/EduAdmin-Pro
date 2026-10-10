import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '@/lib/api'
import { AuthLayout } from '@/features/auth/AuthLayout'
import type { Me } from '@/features/auth/types'

const statusLabel = {
  ACTIVE: 'Active',
  PENDING: 'Waiting for admin approval',
  REVOKED: 'Access removed',
} as const

// Temporary signed-in landing page until the admin and teacher dashboards exist.
export function HomePage() {
  const navigate = useNavigate()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) navigate('/login', { replace: true })
      })
  }, [navigate])

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => null)
    navigate('/login', { replace: true })
  }

  if (!me) {
    return (
      <AuthLayout>
        <p className="text-sm text-slate-500">Loading…</p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-[480px] rounded-3xl bg-white/90 px-8 py-10 shadow-[0_30px_80px_-20px_rgba(79,70,229,0.18)]">
        <h1 className="text-xl font-bold text-slate-900">Welcome, {me.fullName}</h1>
        <p className="mt-1 text-sm text-slate-500">{me.email}</p>

        <h2 className="mt-6 text-xs font-semibold tracking-wide text-slate-400 uppercase">Your schools</h2>
        {me.memberships.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            {me.canCreateSchool
              ? 'Your invite is ready. Creating your school is the next step (coming soon).'
              : 'You are not part of any school yet.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {me.memberships.map((m) => (
              <li key={m.schoolId} className="rounded-lg bg-slate-100 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">{m.schoolName}</p>
                <p className="text-xs text-slate-500">
                  {m.role === 'ADMIN' ? 'Administration' : 'Teacher'} · {statusLabel[m.status]}
                </p>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={logout}
          className="mt-8 h-10 w-full rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
    </AuthLayout>
  )
}
