import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Check, Hash, Mail } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthFormSide, AuthPanel } from './AuthPanel'
import { newPasswordProblem } from './passwordRules'

const RESEND_COOLDOWN_S = 60

/**
 * Forgot password: the account's email gets a 6-digit code; the code and a
 * new password set it. Every device is signed out, and the owner is emailed
 * that the password changed. The answer to "send code" is the same whether
 * or not the email has an account.
 */
export function ForgotPasswordPage() {
  const state = useLocation().state as { email?: string } | null
  const [email, setEmail] = useState(state?.email ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  /** True once the request went through, so callers only confirm what really happened. */
  async function sendCode(address: string): Promise<boolean> {
    setError(null)
    setBusy(true)
    try {
      await api('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email: address }) })
      setSentTo(address)
      setNotice(null)
      setCooldown(RESEND_COOLDOWN_S)
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your email')
    const problem = newPasswordProblem(password, confirm)
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    try {
      await api('/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ email: sentTo, code, password }) })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <AuthCard>
        <AuthPanel
          side="right"
          title="Remembered it?"
          description="Sign in to pick up your timetable, tests and reports right where you left them."
          ctaLabel="Sign in"
          ctaTo="/login"
        />
        <AuthFormSide>
          <div>
            <Link to="/login" viewTransition className="au-back">
              ← Back
            </Link>
            <h1 className="mt-4 mb-2">Reset your password</h1>

            {done ? (
              <div role="status" className="au-done mt-6">
                <span className="badge">
                  <Check className="size-6" />
                </span>
                <p className="t">Password changed</p>
                <p className="au-sub">Every device was signed out. Sign in with your new password.</p>
                <Link to="/login" state={{ email: sentTo }} replace viewTransition className="au-cta-dark">
                  Back to sign in
                </Link>
              </div>
            ) : sentTo ? (
              <form onSubmit={reset} noValidate className="space-y-3">
                <p className="au-sub mb-2">
                  If an account uses <span className="font-semibold text-[#0f2147]">{sentTo}</span>, we&apos;ve emailed it a 6-digit code.
                  It works for 15 minutes.
                </p>
                <label className="au-field">
                  <span className="sr-only">Reset code</span>
                  <input
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                      setError(null)
                    }}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    className="au-input au-code"
                  />
                  <Hash className="au-ico" />
                </label>
                <AuthInput label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <AuthInput label="Type it again" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <FormError message={error} />
                {notice && <p className="au-ok mt-3 mb-0">{notice}</p>}
                <SubmitButton busy={busy} label="Set new password" busyLabel="Saving…" />
                <p className="mt-4 text-center text-[13px]">
                  {cooldown > 0 ? (
                    <span className="text-[#5d6888]">Send a new code in {cooldown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendCode(sentTo).then((sent) => sent && setNotice('A new code is on its way.'))}
                      className="font-semibold text-[#4f46e5] hover:underline"
                    >
                      Send a new code
                    </button>
                  )}
                </p>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!email.trim()) return setError('Please enter your email')
                  void sendCode(email.trim())
                }}
                noValidate
              >
                <p className="au-sub mb-5">Enter your account&apos;s email and we&apos;ll send you a code to choose a new password.</p>
                <AuthInput label="Email" icon={Mail} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <FormError message={error} />
                <SubmitButton busy={busy} label="Send code" busyLabel="Sending…" />
              </form>
            )}
          </div>
        </AuthFormSide>
      </AuthCard>
    </AuthLayout>
  )
}
