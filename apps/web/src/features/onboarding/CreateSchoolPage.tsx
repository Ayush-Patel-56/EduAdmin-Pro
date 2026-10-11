import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { FormError } from '@/features/auth/AuthInput'
import { meQueryKey } from '@/features/auth/session'
import { OnboardingCard, OnboardingHeading } from './OnboardingCard'
import { SchoolForm } from './SchoolForm'
import { useSchoolOptions, type SchoolFormValues } from './schoolOptions'

export function CreateSchoolPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: options, error: optionsError } = useSchoolOptions()

  async function create(values: SchoolFormValues) {
    const school = await api<{ id: string; name: string }>('/schools', { method: 'POST', body: JSON.stringify(values) })
    await queryClient.invalidateQueries({ queryKey: meQueryKey })
    navigate('/onboarding/done', { replace: true, state: { schoolName: school.name } })
  }

  return (
    <OnboardingCard backTo="/onboarding">
      <OnboardingHeading icon={Building2} tone="bg-ink">
        Create Your School
      </OnboardingHeading>
      {options ? (
        <div className="mt-6">
          <SchoolForm
            options={options}
            onSubmit={create}
            submitLabel="Create School & Continue"
            submittingLabel="Creating school…"
          />
        </div>
      ) : optionsError ? (
        <FormError message={optionsError.message} />
      ) : (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label="Loading" />
        </div>
      )}
    </OnboardingCard>
  )
}
