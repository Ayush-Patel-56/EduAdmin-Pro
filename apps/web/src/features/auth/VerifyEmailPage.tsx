import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CircleCheck, Mail, MailWarning } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'

type Status = 'idle' | 'verifying' | 'verified' | 'failed'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const location = useLocation()
  const signupEmail = (location.state as { email?: string } | null)?.email ?? ''

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // Guard against StrictMode's double effect: a token can only be used once.
    if (!token || started.current) return
    started.current = true
    api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setStatus('verified'))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
        setStatus('failed')
      })
  }, [token])

  return (
    <AuthLayout>
      <div className="w-full max-w-[420px] rounded-3xl bg-white/90 px-8 py-10 shadow-[0_30px_80px_-20px_rgba(79,70,229,0.18)]">
        {status === 'verifying' && <p className="text-center text-sm text-slate-500">Verifying your email…</p>}

        {status === 'verified' && (
          <div className="text-center">
            <CircleCheck className="mx-auto size-10 text-emerald-500" />
            <h1 className="mt-3 text-xl font-bold text-slate-900">Email verified</h1>
            <p className="mt-1 text-sm text-slate-500">Your account is ready. You can log in now.</p>
            <Link
              to="/login"
              className="mt-6 flex h-10 items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white hover:bg-ink-hover"
            >
              Go to login
            </Link>
          </div>
        )}

        {(status === 'idle' || status === 'failed') && (
          <>
            <div className="text-center">
              {status === 'failed' ? (
                <MailWarning className="mx-auto size-10 text-amber-500" />
              ) : (
                <Mail className="mx-auto size-10 text-brand-600" />
              )}
              <h1 className="mt-3 text-xl font-bold text-slate-900">
                {status === 'failed' ? 'Link not valid' : 'Verify your email'}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {status === 'failed'
                  ? `${error?.replace(/\.?$/, '.')} Request a new link below.`
                  : signupEmail
                    ? `We sent a verification link to ${signupEmail}.`
                    : 'Enter your email and we will send you a new verification link.'}
              </p>
            </div>
            <ResendForm initialEmail={signupEmail} />
          </>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link to="/login" className="hover:text-slate-800">
            ← Back to login
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}

function ResendForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email) {
      setError('Please enter your email')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6" noValidate>
      <AuthInput
        label="Email"
        icon={Mail}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <FormError message={error} />
      {sent && (
        <p className="mt-3 text-center text-xs text-emerald-600">
          If that account needs verifying, a new link is on its way.
        </p>
      )}
      <SubmitButton busy={submitting} label="Resend verification link" busyLabel="Sending…" />
    </form>
  )
}
