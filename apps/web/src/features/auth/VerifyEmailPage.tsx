import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthPanel } from './AuthPanel'
import { OtpVerification } from './OtpVerification'

type VerifyState = { email?: string; autoSend?: boolean } | null

/**
 * Standalone email verification: request a code, then enter it. Reached from
 * the login page's "Verify email" link, or automatically when an unverified
 * teacher tries to sign in (`autoSend`).
 */
export function VerifyEmailPage() {
  const state = useLocation().state as VerifyState
  const [email, setEmail] = useState(state?.email ?? '')
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const autoSent = useRef(false)

  async function sendCode(address: string) {
    setError(null)
    setSending(true)
    try {
      await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: address }) })
      setCodeSentTo(address)
    } catch (err) {
      // A code was sent moments ago (e.g. at signup): let them enter that one.
      if (err instanceof ApiError && err.status === 429) setCodeSentTo(address)
      else setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    // Guard against StrictMode's double effect sending two codes.
    if (state?.autoSend && state.email && !autoSent.current) {
      autoSent.current = true
      void sendCode(state.email)
    }
  }, [state])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Please enter your email')
      return
    }
    void sendCode(email.trim())
  }

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
            <Link to="/login" className="text-xs text-slate-500 hover:text-slate-800">
              ← Back
            </Link>
            <h1 className="mt-3 mb-4 text-xl font-bold text-slate-900">Verify Email</h1>

            {codeSentTo ? (
              <OtpVerification email={codeSentTo} />
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <p className="mb-3 text-xs text-slate-500">
                  {state?.autoSend
                    ? 'Your email is not verified yet. Sending you a code…'
                    : "Enter your account's email and we'll send you a 6-digit code."}
                </p>
                <AuthInput
                  label="Email"
                  icon={Mail}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <FormError message={error} />
                <SubmitButton busy={sending} label="Send code" busyLabel="Sending…" />
              </form>
            )}
          </div>
        </section>
      </AuthCard>
    </AuthLayout>
  )
}
