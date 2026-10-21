import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Hash } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { FormError, SubmitButton } from './AuthInput'

const RESEND_COOLDOWN_S = 60

type OtpVerificationProps = {
  email: string
  /** Seconds before "Resend code" is allowed (a code was usually just sent). */
  initialCooldown?: number
}

/** Enter the 6-digit email code; shows the "Email verified" state when done. */
export function OtpVerification({ email, initialCooldown = RESEND_COOLDOWN_S }: OtpVerificationProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verified, setVerified] = useState(false)
  const [cooldown, setCooldown] = useState(initialCooldown)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email')
      return
    }
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) })
      setVerified(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  async function resend() {
    setError(null)
    setNotice(null)
    try {
      await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) })
      setCode('')
      setNotice('A new code is on its way.')
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    }
  }

  if (verified) {
    return (
      <div role="status" className="au-done mt-6">
        <span className="badge">
          <Check className="size-6" />
        </span>
        <p className="t">Email verified</p>
        <p className="au-sub">Your account is active. You can sign in now.</p>
        <Link
          to="/login"
          state={{ email }}
          replace
          viewTransition
          className="au-cta-dark"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <p className="au-sub mb-4">
        Enter the 6-digit code sent to <span className="font-semibold text-[#0f2147]">{email}</span>
      </p>
      <label className="au-field">
        <span className="sr-only">Verification code</span>
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

      <FormError message={error} />
      {notice && <p className="au-ok mt-3 mb-0">{notice}</p>}
      <SubmitButton busy={submitting} label="Verify Email" busyLabel="Verifying…" />

      <p className="mt-4 text-center text-[13px]">
        {cooldown > 0 ? (
          <span className="text-[#5d6888]">Resend code in {cooldown}s</span>
        ) : (
          <button type="button" onClick={resend} className="font-semibold text-[#4f46e5] hover:underline">
            Resend code
          </button>
        )}
      </p>
    </form>
  )
}
