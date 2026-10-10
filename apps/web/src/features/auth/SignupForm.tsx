import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleCheck, type LucideIcon } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from './AuthInput'
import { AuthLayout } from './AuthLayout'
import { AuthCard, AuthPanel } from './AuthPanel'

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

export function SignupForm({ title, endpoint, fields, hint }: SignupFormProps) {
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(false)

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
      await api(endpoint, { method: 'POST', body: JSON.stringify(values) })
      setCreated(true)
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
          title="Welcome Back!"
          description="To stay connected with your institution, please login."
          ctaLabel="Sign in"
          ctaTo="/login"
        />

        <section className="flex flex-1 items-center justify-center px-8 py-12 md:px-12">
          {created ? (
            <div role="status" className="w-full max-w-[352px] text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100">
                <CircleCheck className="size-7 text-emerald-600" />
              </span>
              <h1 className="mt-4 text-xl font-bold text-slate-900">Account created successfully</h1>
              <p className="mt-1 text-sm text-slate-500">Redirecting you to login…</p>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="w-full max-w-[352px]" noValidate>
            <Link to="/signup" className="text-xs text-slate-500 hover:text-slate-800">
              ← Back
            </Link>
            <h1 className="mt-3 mb-4 text-xl font-bold text-slate-900">{title}</h1>

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

            {hint && <p className="mt-2 px-0.5 text-[11px] text-slate-500">{hint}</p>}

            <FormError message={error} />
            <SubmitButton busy={submitting} label="Create Account" busyLabel="Creating account…" />
          </form>
          )}
        </section>
      </AuthCard>
    </AuthLayout>
  )
}
