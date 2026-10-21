import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { User } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthFormSide, AuthPanel } from './AuthPanel'
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
      navigate('/app', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        navigate('/verify-email', { state: { email, autoSend: true } })
        return
      }
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
          title="New to EduAdmin Pro?"
          description="Set up your school or join as a teacher. It takes a few minutes."
          ctaLabel="Create account"
          ctaTo="/signup"
        />

        <AuthFormSide>
          <form onSubmit={handleSubmit} noValidate>
            <h1>Login</h1>
            <p className="au-sub mb-6">Welcome back. Sign in to your school.</p>

            {fromSignup?.signedUp && (
              <p className="au-ok">Account created. Log in to continue.</p>
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

            <div className="au-links">
              <Link to="/verify-email" state={{ email }} viewTransition>
                Verify email
              </Link>
              <Link to="/forgot-password" viewTransition>
                Forgot Password?
              </Link>
            </div>

            <FormError message={error} />
            <SubmitButton busy={submitting} label="Login" busyLabel="Logging in…" />
          </form>
        </AuthFormSide>
      </AuthCard>
    </AuthLayout>
  )
}
