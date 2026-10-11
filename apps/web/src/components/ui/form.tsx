import { useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'
import { btnDanger, btnSecondary, labelClass } from './formStyles'

type FieldProps = { id: string; label: string; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string }

export function Field({ id, label, error, hint, children, className }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-[10px] text-slate-400">{hint}</p>
      )}
    </div>
  )
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
      {message}
    </p>
  )
}

type ConfirmDialogProps = {
  title: string
  message: ReactNode
  confirmLabel: string
  onConfirm: () => Promise<void>
  onClose: () => void
}

/** "Are you sure?" for destructive actions; shows the API's error if it refuses. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={onClose} widthClass="max-w-md">
      <div className="space-y-4 px-6 py-5 text-sm text-slate-600">
        <div>{message}</div>
        <ErrorBanner message={error} />
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>
          Cancel
        </button>
        <button type="button" onClick={confirm} disabled={busy} className={btnDanger}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
