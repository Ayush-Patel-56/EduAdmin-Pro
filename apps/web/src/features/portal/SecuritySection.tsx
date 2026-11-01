import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, LogOut } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { inputClass } from '@/components/ui/formStyles'
import { FormError } from '@/features/auth/AuthInput'
import { newPasswordProblem } from '@/features/auth/passwordRules'

const SESSIONS_KEY = ['auth-sessions']

/**
 * Account security in Preferences: change the password (needs the current
 * one; signs out the other devices) and sign out every other device.
 */
export function SecuritySection() {
  const client = useQueryClient()
  // Always current when Preferences opens: a device signed in elsewhere a minute ago counts.
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => api<{ others: number }>('/auth/sessions'), staleTime: 0 })
  const [changing, setChanging] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const others = sessions.data?.others ?? 0

  async function signOutOthers() {
    setSigningOut(true)
    setSignOutError(null)
    try {
      const { signedOut } = await api<{ signedOut: number }>('/auth/sessions/sign-out-others', { method: 'POST' })
      setMessage(signedOut ? `Signed out of ${signedOut} other device${signedOut === 1 ? '' : 's'}.` : 'No other devices were signed in.')
      await client.invalidateQueries({ queryKey: SESSIONS_KEY })
    } catch (err) {
      setSignOutError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <fieldset>
      <legend className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Security</legend>
      <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-slate-900">Password</span>
              <span className="block text-xs text-slate-500">Changing it signs out your other devices.</span>
            </span>
            {!changing && (
              <button type="button" onClick={() => { setChanging(true); setMessage(null) }} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline">
                <KeyRound className="size-3.5" /> Change password
              </button>
            )}
          </div>
          {changing && (
            <ChangePasswordForm
              onDone={async (signedOut) => {
                setChanging(false)
                setMessage(`Password changed.${signedOut ? ` Signed out of ${signedOut} other device${signedOut === 1 ? '' : 's'}.` : ''}`)
                await client.invalidateQueries({ queryKey: SESSIONS_KEY })
              }}
              onCancel={() => setChanging(false)}
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span>
            <span className="block text-sm font-medium text-slate-900">Other devices</span>
            <span className="block text-xs text-slate-500">
              {sessions.isPending ? 'Checking…' : others ? `Signed in on ${others} other device${others === 1 ? '' : 's'}.` : 'Not signed in anywhere else.'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void signOutOthers()}
            disabled={signingOut || others === 0}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          >
            {signingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />} Sign out other devices
          </button>
        </div>
      </div>
      {message && <p role="status" className="mt-2 text-[11px] text-emerald-700">{message}</p>}
      <FormError message={signOutError} />
    </fieldset>
  )
}

function ChangePasswordForm({ onDone, onCancel }: { onDone: (signedOut: number) => Promise<void>; onCancel: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!current) return setError('Enter your current password')
    const problem = newPasswordProblem(next, confirm)
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    try {
      const { signedOut } = await api<{ signedOut: number }>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) })
      await onDone(signedOut)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-2">
      <input type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass()} />
      <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" aria-label="New password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass()} />
      <input type="password" autoComplete="new-password" placeholder="Type the new password again" aria-label="Type the new password again" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass()} />
      <FormError message={error} />
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={busy} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-9 rounded-lg bg-ink px-3 text-xs font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </div>
    </form>
  )
}
