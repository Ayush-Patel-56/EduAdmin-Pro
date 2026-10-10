import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { School } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthInput, FormError, SubmitButton } from '@/features/auth/AuthInput'
import { AuthLayout } from '@/features/auth/AuthLayout'

export function CreateSchoolPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 3) {
      setError('School name must be at least 3 characters')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const school = await api<{ id: string }>('/schools', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      navigate(`/schools/${school.id}/codes`, { replace: true, state: { justCreated: true } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="w-full max-w-[420px] rounded-3xl bg-white/90 px-8 py-10 shadow-[0_30px_80px_-20px_rgba(79,70,229,0.18)]"
      >
        <Link to="/" className="text-xs text-slate-500 hover:text-slate-800">
          ← Back
        </Link>
        <h1 className="mt-3 text-xl font-bold text-slate-900">Create your school</h1>
        <p className="mt-1 mb-5 text-sm text-slate-500">
          You'll be its first admin. Teacher and admin join codes are generated next.
        </p>

        <AuthInput
          label="School name"
          icon={School}
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <FormError message={error} />
        <SubmitButton busy={submitting} label="Create school" busyLabel="Creating…" />
      </form>
    </AuthLayout>
  )
}
