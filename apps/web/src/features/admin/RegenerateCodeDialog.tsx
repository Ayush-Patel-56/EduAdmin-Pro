import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'

type RegenerateCodeDialogProps = {
  schoolId: string
  kind: 'ADMIN' | 'TEACHER'
  onClose: () => void
}

const COPY = {
  ADMIN: {
    title: 'Regenerate admin invite code?',
    body: 'The current admin code stops working immediately. Anyone you gave it to who hasn’t joined yet will need the new one. Existing admins keep their access.',
  },
  TEACHER: {
    title: 'Regenerate teacher invite code?',
    body: 'The current teacher code stops working immediately. Teachers who haven’t joined yet will need the new one. Existing teachers keep their access.',
  },
} as const

/** Confirms, then replaces one of the school's invite codes (the old one stops working at once). */
export function RegenerateCodeDialog({ schoolId, kind, onClose }: RegenerateCodeDialogProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      await api(`/schools/${schoolId}/regenerate-code`, { method: 'POST', body: JSON.stringify({ kind }) })
      // The dashboard and the school list both show the codes.
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes(schoolId) || q.queryKey[0] === 'my-schools' })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate the code')
      setBusy(false)
    }
  }

  return (
    <Dialog title={COPY[kind].title} onClose={onClose} widthClass="max-w-md">
      <div className="space-y-4 px-6 py-5 text-sm text-slate-600">
        <p>{COPY[kind].body}</p>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? 'Regenerating…' : 'Regenerate Code'}
        </button>
      </div>
    </Dialog>
  )
}
