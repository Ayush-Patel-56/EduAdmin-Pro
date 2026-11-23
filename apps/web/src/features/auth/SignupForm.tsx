import { useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
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
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

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

/** Every new account, admin or teacher, goes straight to the email code step: no one signs in unverified. */
export function SignupForm({ title, endpoint, fields, hint }: SignupFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Set once the account exists and is waiting for its email code.
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)

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
      const result = await api<{ email: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(values),
      })
      setVerifyEmail(result.email)
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
          {verifyEmail ? (
            <div>
              <Link to="/signup" viewTransition className="au-back">
                ← Back
              </Link>
              <h1 className="mt-4 mb-5">{title}</h1>
              <OtpVerification email={verifyEmail} password={values.password} />
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
            <p className="au-sub mt-3 text-[12px]">
              By creating an account you agree to the <Link to="/terms" className="underline">Terms of Service</Link> and the{' '}
              <Link to="/privacy" className="underline">Privacy Policy</Link>.
            </p>

            <FormError message={error} />
            <SubmitButton busy={submitting} label="Create Account" busyLabel="Creating account…" />
          </form>
          )}
        </AuthFormSide>
      </AuthCard>
    </AuthLayout>
  )
}
