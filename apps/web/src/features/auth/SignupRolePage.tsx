import { Link } from 'react-router-dom'
import { Building2, ChevronRight, User, type LucideIcon } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthFormSide, AuthPanel } from './AuthPanel'

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
          title="Already have an account?"
          description="Sign in to pick up your timetable, tests and reports right where you left them."
          ctaLabel="Sign in"
          ctaTo="/login"
        />

        <AuthFormSide>
          <div>
            <h1>Create Account</h1>
            <p className="au-sub">Select your role to continue</p>

            <ul className="mt-7 space-y-3">
              {roles.map(({ to, icon: Icon, title, description }) => (
                <li key={to}>
                  <Link to={to} viewTransition className={`au-role ${to.endsWith('admin') ? 'admin' : ''}`}>
                    <span className="au-role-ic">
                      <Icon className="size-5" />
                    </span>
                    <span>
                      <b>{title}</b>
                      <small>{description}</small>
                    </span>
                    <ChevronRight className="chev size-5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </AuthFormSide>
      </AuthCard>
    </AuthLayout>
  )
}
