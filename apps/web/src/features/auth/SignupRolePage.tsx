import { Link } from 'react-router-dom'
import { Building2, ChevronRight, User, type LucideIcon } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthPanel } from './AuthPanel'

type RoleOption = {
  to: string
  icon: LucideIcon
  title: string
  description: string
}

const roles: RoleOption[] = [
  {
    to: '/signup/teacher',
    icon: User,
    title: 'Teacher',
    description: 'Institutional email · requires verification',
  },
  {
    to: '/signup/admin',
    icon: Building2,
    title: 'Administration',
    description: 'Staff accounts · invite code required',
  },
]

export function SignupRolePage() {
  return (
    <AuthLayout>
      <AuthCard>
        <AuthPanel
          side="right"
          title="Welcome Back!"
          description="To stay connected with your institution, please login."
          ctaLabel="Sign in"
          ctaTo="/login"
        />

        <section className="flex flex-1 items-center justify-center px-8 py-12 md:px-12">
          <div className="w-full max-w-[352px]">
            <h1 className="text-center text-2xl font-bold text-slate-900">Create Account</h1>
            <p className="mt-1 text-center text-xs text-slate-500">Select your role to continue</p>

            <ul className="mt-6 space-y-3">
              {roles.map(({ to, icon: Icon, title, description }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="group flex items-center gap-3 rounded-lg bg-slate-100 px-4 py-3 transition hover:bg-slate-200/70 focus-visible:ring-2 focus-visible:ring-brand-600/40 focus-visible:outline-none"
                  >
                    <Icon className="size-4 shrink-0 text-slate-400" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-slate-900">{title}</span>
                      <span className="block text-[11px] text-slate-500">{description}</span>
                    </span>
                    <ChevronRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </AuthCard>
    </AuthLayout>
  )
}
