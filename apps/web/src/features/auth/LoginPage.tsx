import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, User } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthPanel } from './AuthPanel'

const inputClass =
  'h-10 w-full rounded-lg bg-slate-100 pr-10 pl-4 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-600/40 focus:outline-none'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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

            <div className="space-y-3">
              <label className="relative block">
                <span className="sr-only">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
                <User className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-slate-400" />
              </label>

              <label className="relative block">
                <span className="sr-only">Password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </label>
            </div>

            <div className="mt-3 flex justify-between text-xs text-slate-500">
              <Link to="/verify-email" className="hover:text-slate-800">
                Verify email
              </Link>
              <Link to="/forgot-password" className="hover:text-slate-800">
                Forgot Password?
              </Link>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-center text-xs text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-4 h-10 w-full rounded-lg bg-ink text-sm font-semibold text-white transition hover:bg-ink-hover disabled:opacity-60"
            >
              {submitting ? 'Logging in…' : 'Login'}
            </button>
          </form>
        </section>
      </AuthCard>
    </AuthLayout>
  )
}
