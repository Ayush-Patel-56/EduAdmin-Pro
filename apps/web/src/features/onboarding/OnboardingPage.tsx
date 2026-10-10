import { Link } from 'react-router-dom'
import { Hash, Plus, type LucideIcon } from 'lucide-react'
import { useMe } from '@/features/auth/session'
import { adminSchools, firstName } from '@/features/auth/types'
import { OnboardingCard } from './OnboardingCard'

type Choice = {
  to: string
  icon: LucideIcon
  title: string
  description: string
  className: string
  iconClassName: string
}

const choices: Choice[] = [
  {
    to: '/onboarding/create',
    icon: Plus,
    title: 'Create a New School',
    description: 'Set up a fresh institution and get an invite code to share',
    className: 'bg-[#eef4ff] hover:bg-[#e3ecff]',
    iconClassName: 'bg-ink',
  },
  {
    to: '/onboarding/join',
    icon: Hash,
    title: 'Join an Existing School',
    description: 'Enter the invite code from another administrator',
    className: 'border border-slate-200 bg-slate-50 hover:bg-slate-100',
    iconClassName: 'bg-slate-700',
  },
]

export function OnboardingPage() {
  const { data: me } = useMe()
  if (!me) return null
  const hasSchools = adminSchools(me).length > 0

  return (
    <OnboardingCard backTo={hasSchools ? '/dashboard' : undefined}>
      <div className={`text-center ${hasSchools ? 'mt-2' : 'mt-4'}`}>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {firstName(me)}!</h1>
        <p className="mt-1 text-sm text-slate-400">
          {hasSchools ? 'Add another school to manage' : "Let's set up your school to get started"}
        </p>
      </div>

      <ul className="mt-8 space-y-3">
        {choices.map(({ to, icon: Icon, title, description, className, iconClassName }) => (
          <li key={to}>
            <Link
              to={to}
              className={`flex items-center gap-4 rounded-2xl px-5 py-4 transition focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:outline-none ${className}`}
            >
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-white ${iconClassName}`}>
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">{title}</span>
                <span className="block text-xs text-slate-500">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </OnboardingCard>
  )
}
