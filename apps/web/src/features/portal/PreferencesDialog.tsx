import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { FormError } from '@/features/auth/AuthInput'
import { meQueryKey } from '@/features/auth/session'
import { preferencesOf, type AccentTheme, type Me, type Preferences } from '@/features/auth/types'

const ACCENTS: { value: AccentTheme; label: string; swatch: string }[] = [
  { value: 'INDIGO', label: 'Indigo', swatch: 'bg-[#4f46e5]' },
  { value: 'BLUE', label: 'Blue', swatch: 'bg-[#2563eb]' },
  { value: 'EMERALD', label: 'Emerald', swatch: 'bg-[#059669]' },
  { value: 'SLATE', label: 'Slate', swatch: 'bg-[#475569]' },
]

type PreferencesDialogProps = {
  me: Me
  /** Accent used when the user hasn't picked one (differs per portal). */
  defaultAccent: AccentTheme
  roleLabel: string
  onClose: () => void
}

export function PreferencesDialog({ me, defaultAccent, roleLabel, onClose }: PreferencesDialogProps) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Preferences>(() => preferencesOf(me))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const accent = values.accentTheme ?? defaultAccent
  const initial = me.fullName.trim().charAt(0).toUpperCase()

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const preferences = await api<Preferences>('/auth/preferences', {
        method: 'PATCH',
        body: JSON.stringify(values),
      })
      queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, preferences } : old))
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      setSaving(false)
    }
  }

  return (
    <Dialog title="Account Preferences" description="Notifications and appearance for your account" onClose={onClose}>
      <div className="space-y-6 px-6 py-5">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{me.fullName}</p>
            <p className="truncate text-xs text-slate-500">{me.email}</p>
            <span className="mt-1 inline-block rounded-md bg-brand-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-600 uppercase">
              {roleLabel}
            </span>
          </div>
        </div>

        <fieldset>
          <legend className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Notifications</legend>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            <Toggle
              label="Email Notifications"
              hint="Daily report digest by email"
              checked={values.emailNotifications}
              onChange={(v) => setValues((p) => ({ ...p, emailNotifications: v }))}
            />
            <Toggle
              label="Syllabus Updates"
              hint="Alerts when syllabus coverage changes"
              checked={values.syllabusUpdates}
              onChange={(v) => setValues((p) => ({ ...p, syllabusUpdates: v }))}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Accent theme</legend>
          <div role="radiogroup" aria-label="Accent theme" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ACCENTS.map((a) => {
              const selected = a.value === accent
              return (
                <button
                  key={a.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setValues((p) => ({ ...p, accentTheme: a.value }))}
                  className={`flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
                    selected ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className={`flex size-4 items-center justify-center rounded-full ${a.swatch}`}>
                    {selected && <Check className="size-3 text-white" />}
                  </span>
                  {a.label}
                </button>
              )
            })}
          </div>
        </fieldset>

        <FormError message={error} />
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink-hover disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save Preferences'}
        </button>
      </div>
    </Dialog>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </label>
  )
}
