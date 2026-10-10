import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { User } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthPanel } from './AuthPanel'
import { meQueryKey } from './session'

export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fromSignup = useLocation().state as { email?: string; signedUp?: boolean } | null
  const [email, setEmail] = useState(fromSignup?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter your email and password')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      await queryClient.invalidateQueries({ queryKey: meQueryKey })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <AuthCard>
        <AuthPanel
          side="left"
          title="New Here?"
          description="Join the most advanced academic planning ecosystem today."
          ctaLabel="Create account"
          ctaTo="/signup"
        />

        <section className="flex flex-1 items-center justify-center px-8 py-12 md:px-12">
          <form onSubmit={handleSubmit} className="w-full max-w-[352px]" noValidate>
            <h1 className="mb-6 text-center text-2xl font-bold text-slate-900">Login</h1>

            {fromSignup?.signedUp && (
              <p className="-mt-3 mb-4 text-center text-xs text-emerald-600">Account created. Log in to continue.</p>
            )}

            <div className="space-y-3">
              <AuthInput
                label="Email"
                icon={User}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <AuthInput
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="mt-3 flex justify-between text-xs text-slate-500">
              <Link to="/verify-email" className="hover:text-slate-800">
                Verify email
              </Link>
              <Link to="/forgot-password" className="hover:text-slate-800">
                Forgot Password?
              </Link>
            </div>

            <FormError message={error} />
            <SubmitButton busy={submitting} label="Login" busyLabel="Logging in…" />
          </form>
        </section>
      </AuthCard>
    </AuthLayout>
  )
}
