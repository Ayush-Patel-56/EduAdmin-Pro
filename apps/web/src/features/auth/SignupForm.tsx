import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleCheck, type LucideIcon } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthFormSide, AuthPanel } from './AuthPanel'
import { OtpVerification } from './OtpVerification'

export type SignupField = {
  name: string
  label: string
  icon?: LucideIcon
  type?: InputHTMLAttributes<HTMLInputElement>['type']
  autoComplete?: string
  required?: boolean
  // Normalise the raw value before it is stored, e.g. upper-casing codes.
  transform?: (value: string) => string
}

type SignupFormProps = {
  title: string
  endpoint: string
  fields: SignupField[]
  hint?: string
  /** 'verify': show the email code step after signup. 'login': confirm, then go to login. */
  next?: 'verify' | 'login'
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const REDIRECT_DELAY_MS = 1800

function validate(fields: SignupField[], values: Record<string, string>): string | null {
  const missing = fields.find((f) => f.required && !values[f.name]?.trim())
  // Drop placeholder hints like "(min. 8 chars)" from the label.
  if (missing) return `${missing.label.replace(/\s*\(.*\)$/, '')} is required`

  const email = fields.find((f) => f.type === 'email')
  if (email && !EMAIL_PATTERN.test(values[email.name])) return 'Please enter a valid email address'

  const password = fields.find((f) => f.type === 'password')
  if (password && values[password.name].length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  return null
}

export function SignupForm({ title, endpoint, fields, hint, next = 'login' }: SignupFormProps) {
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(false)
  // Set once a teacher account exists and is waiting for its email code.
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!created) return
    const timer = setTimeout(
      () => navigate('/login', { replace: true, state: { email: values.email, signedUp: true } }),
      REDIRECT_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [created, navigate, values.email])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate(fields, values)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const result = await api<{ email: string; verificationRequired?: boolean }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(values),
      })
      // Admins verify too when the server requires it (always in production).
      if (next === 'verify' || result.verificationRequired) setVerifyEmail(result.email)
      else setCreated(true)
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
          side="right"
          title="Already have an account?"
          description="Sign in to pick up your timetable, tests and reports right where you left them."
          ctaLabel="Sign in"
          ctaTo="/login"
        />

        <AuthFormSide>
          {created ? (
            <div role="status" className="au-done">
              <span className="badge">
                <CircleCheck className="size-7" />
              </span>
              <h1 className="text-2xl">Account created successfully</h1>
              <p className="au-sub">Redirecting you to login…</p>
            </div>
          ) : verifyEmail ? (
            <div>
              <Link to="/signup" viewTransition className="au-back">
                ← Back
              </Link>
              <h1 className="mt-4 mb-5">{title}</h1>
              <OtpVerification email={verifyEmail} />
            </div>
          ) : (
          <form onSubmit={handleSubmit} noValidate>
            <Link to="/signup" viewTransition className="au-back">
              ← Back
            </Link>
            <h1 className="mt-4 mb-5">{title}</h1>

            <div className="space-y-2.5">
              {fields.map((f) => (
                <AuthInput
                  key={f.name}
                  name={f.name}
                  label={f.label}
                  icon={f.icon}
                  type={f.type}
                  autoComplete={f.autoComplete}
                  required={f.required}
                  value={values[f.name]}
                  onChange={(e) => {
                    const value = f.transform ? f.transform(e.target.value) : e.target.value
                    setValues((v) => ({ ...v, [f.name]: value }))
                  }}
                />
              ))}
            </div>

            {hint && <p className="au-sub mt-2 text-[13px]">{hint}</p>}

            <FormError message={error} />
            <SubmitButton busy={submitting} label="Create Account" busyLabel="Creating account…" />
          </form>
          )}
        </AuthFormSide>
      </AuthCard>
    </AuthLayout>
  )
}
