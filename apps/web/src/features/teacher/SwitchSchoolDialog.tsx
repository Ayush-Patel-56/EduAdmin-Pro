import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Hash, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { meQueryKey } from '@/features/auth/session'
import { teacherDashboardQueryKey } from './useTeacherDashboard'

type SwitchSchoolDialogProps = {
  currentSchool: string | null
  onClose: () => void
}

export function SwitchSchoolDialog({ currentSchool, onClose }: SwitchSchoolDialogProps) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const title = currentSchool ? 'Switch School' : 'Join School'

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setError(null)
    setSubmitting(true)
    try {
      await api('/schools/join', { method: 'POST', body: JSON.stringify({ inviteCode: code }) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: meQueryKey }),
        queryClient.invalidateQueries({ queryKey: teacherDashboardQueryKey }),
      ])
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-school-title"
        className="relative w-full max-w-[410px] overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 pt-6 pb-5">
          <div>
            <h2 id="switch-school-title" className="text-lg font-bold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Enter the school invite code provided by your administration</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700">
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="px-6 pt-5 pb-6">
          {currentSchool && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Currently in</p>
              <p className="mt-1.5 flex items-center gap-2 text-sm text-slate-800">
                <Building2 className="size-4 text-slate-500" /> {currentSchool}
              </p>
            </div>
          )}

          <label htmlFor="switch-school-code" className="mt-5 block text-[11px] font-bold tracking-wider text-slate-600 uppercase">
            School invite code
          </label>
          <div className="relative mt-2">
            <Hash className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              id="switch-school-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setError(null)
              }}
              placeholder="E.G. GGLD-XNYM"
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white pr-4 pl-10 font-mono text-sm font-semibold tracking-wider text-slate-900 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 focus:outline-none"
            />
          </div>

          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] text-red-700">
              {error}
            </p>
          ) : (
            currentSchool && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
                Entering a new code will switch you to the new school. Your existing school access will be removed.
              </p>
            )
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!code.trim() || submitting}
              className="h-10 rounded-xl bg-ink text-sm font-semibold text-white transition hover:bg-ink-hover disabled:bg-slate-400"
            >
              {submitting ? 'Switching…' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
