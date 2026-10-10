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
      <div role="status" className="mt-6 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-100">
          <Check className="size-5 text-emerald-600" />
        </span>
        <p className="mt-3 text-sm font-semibold text-slate-900">Email verified</p>
        <p className="mt-1 text-xs text-slate-400">Your account is active — you can sign in now</p>
        <Link
          to="/login"
          state={{ email }}
          replace
          className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <p className="mb-3 text-xs text-slate-500">
        Enter the 6-digit code sent to <span className="font-semibold text-slate-700">{email}</span>
      </p>
      <label className="relative block">
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
          className="h-10 w-full rounded-lg bg-slate-100 px-10 text-center font-mono text-sm font-semibold tracking-[0.5em] text-slate-900 placeholder:font-sans placeholder:font-semibold placeholder:tracking-[0.4em] placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-600/40 focus:outline-none"
        />
        <Hash className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-slate-400" />
      </label>

      <FormError message={error} />
      {notice && <p className="mt-3 text-center text-xs text-emerald-600">{notice}</p>}
      <SubmitButton busy={submitting} label="Verify Email" busyLabel="Verifying…" />

      <p className="mt-4 text-center text-xs">
        {cooldown > 0 ? (
          <span className="text-slate-400">Resend code in {cooldown}s</span>
        ) : (
          <button type="button" onClick={resend} className="font-medium text-brand-600 hover:underline">
            Resend code
          </button>
        )}
      </p>
    </form>
  )
}
