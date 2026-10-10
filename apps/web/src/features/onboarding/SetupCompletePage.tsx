import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CircleCheck } from 'lucide-react'
import { OnboardingCard } from './OnboardingCard'

const REDIRECT_DELAY_MS = 1800

export function SetupCompletePage() {
  const navigate = useNavigate()
  const schoolName = (useLocation().state as { schoolName?: string } | null)?.schoolName

  useEffect(() => {
    if (!schoolName) return
    const timer = setTimeout(() => navigate('/dashboard', { replace: true }), REDIRECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [navigate, schoolName])

  // Reached by refreshing or typing the URL: nothing to confirm, go straight on.
  if (!schoolName) return <Navigate to="/dashboard" replace />

  return (
    <OnboardingCard>
      <div role="status" className="py-10 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100">
          <CircleCheck className="size-7 text-emerald-600" />
        </span>
        <h1 className="mt-4 text-lg font-bold text-slate-900">You're all set!</h1>
        <p className="mt-1 text-sm text-slate-400">Taking you to {schoolName}'s dashboard...</p>
      </div>
    </OnboardingCard>
  )
}
