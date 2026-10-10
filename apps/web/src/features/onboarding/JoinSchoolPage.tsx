import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Hash } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { FormError } from '@/features/auth/AuthInput'
import { meQueryKey } from '@/features/auth/session'
import { fieldLabelClass, OnboardingCard, OnboardingHeading } from './OnboardingCard'

export function JoinSchoolPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) {
      setError('Please enter the invite code')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const school = await api<{ id: string; name: string }>('/schools/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode: code }),
      })
      await queryClient.invalidateQueries({ queryKey: meQueryKey })
      navigate('/onboarding/done', { replace: true, state: { schoolName: school.name } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      setSubmitting(false)
    }
  }

  return (
    <OnboardingCard backTo="/onboarding" className="max-w-[512px]">
      <OnboardingHeading icon={Hash} tone="bg-slate-700">
        Join a School
      </OnboardingHeading>

      <form onSubmit={handleSubmit} noValidate className="mt-6">
        <label htmlFor="invite-code" className={fieldLabelClass}>
          Invite code
        </label>
        <input
          id="invite-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            setError(null)
          }}
          placeholder="EDUA-4821"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          maxLength={32}
          className="h-11 w-full rounded-lg border-2 border-indigo-100 bg-slate-50 px-4 font-mono text-sm font-semibold tracking-[0.2em] text-slate-900 placeholder:text-slate-400 focus:border-indigo-200 focus:bg-white focus:outline-none"
        />
        <FormError message={error} />
        <button
          type="submit"
          disabled={submitting}
          className="mt-3 h-10 w-full rounded-lg bg-[#111827] text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
        >
          {submitting ? 'Joining…' : 'Join School & Continue'}
        </button>
      </form>
    </OnboardingCard>
  )
}
