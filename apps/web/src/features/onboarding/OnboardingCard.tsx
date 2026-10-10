import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LogOut, type LucideIcon } from 'lucide-react'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { useLogout } from '@/features/auth/session'

type OnboardingCardProps = {
  children: ReactNode
  backTo?: string
  className?: string
}

/** White onboarding card with "Sign out" in the corner. */
export function OnboardingCard({ children, backTo, className = 'max-w-[512px]' }: OnboardingCardProps) {
  const logout = useLogout()
  return (
    <AuthLayout>
      <div
        className={`relative w-full rounded-3xl bg-white/95 px-6 pt-8 pb-8 shadow-[0_30px_80px_-20px_rgba(15,23,42,0.18)] sm:px-10 ${className}`}
      >
        <button
          type="button"
          onClick={logout}
          className="absolute top-6 right-6 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700"
        >
          <LogOut className="size-3.5" /> Sign out
        </button>
        {backTo && (
          <Link to={backTo} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700">
            <ArrowLeft className="size-3.5" /> Back
          </Link>
        )}
        {children}
      </div>
    </AuthLayout>
  )
}

export function OnboardingHeading({ icon: Icon, tone, children }: { icon: LucideIcon; tone: string; children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <span className={`flex size-10 items-center justify-center rounded-xl text-white ${tone}`}>
        <Icon className="size-5" />
      </span>
      <h1 className="text-xl font-bold text-slate-900">{children}</h1>
    </div>
  )
}

export const fieldLabelClass = 'mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase'
