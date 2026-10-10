import { useLogout, useMe } from '@/features/auth/session'
import { firstName } from '@/features/auth/types'
import { OnboardingCard } from '@/features/onboarding/OnboardingCard'

const statusLabel = {
  ACTIVE: 'Active',
  PENDING: 'Waiting for admin approval',
  REVOKED: 'Access removed',
} as const

// Temporary landing page for teachers until the faculty flow is built.
export function TeacherHomePage() {
  const { data: me } = useMe()
  const logout = useLogout()
  if (!me) return null

  return (
    <OnboardingCard>
      <div className="mt-2 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {firstName(me)}!</h1>
        <p className="mt-1 text-sm text-slate-400">{me.email}</p>
      </div>
      <ul className="mt-6 space-y-2">
        {me.memberships.map((m) => (
          <li key={m.schoolId} className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{m.schoolName}</p>
            <p className="text-xs text-slate-500">Teacher · {statusLabel[m.status]}</p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={logout}
        className="mt-6 h-10 w-full rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Sign out
      </button>
    </OnboardingCard>
  )
}
