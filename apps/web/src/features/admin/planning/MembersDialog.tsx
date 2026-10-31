import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UserMinus, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnDanger, btnSecondary } from '@/components/ui/formStyles'

type Member = { userId: string; fullName: string; email: string; role: 'ADMIN' | 'TEACHER'; status: 'ACTIVE' | 'REVOKED'; isOwner: boolean; isYou: boolean }

type Props = { schoolId: string; schoolName: string; callerIsOwner: boolean; onClose: () => void }

/**
 * Who can get into this school. Removing someone ends their access at once
 * and stops the invite code letting them back in; "Allow to rejoin" lifts
 * that, so they can join again with a current code.
 */
export function MembersDialog({ schoolId, schoolName, callerIsOwner, onClose }: Props) {
  const client = useQueryClient()
  const key = [schoolId, 'members']
  const members = useQuery({ queryKey: key, queryFn: () => api<Member[]>(`/schools/${schoolId}/members`) })
  const groups: [string, Member[]][] = [
    ['Admins', members.data?.filter((m) => m.role === 'ADMIN') ?? []],
    ['Teachers', members.data?.filter((m) => m.role === 'TEACHER') ?? []],
  ]
  return (
    <Dialog
      title="Members"
      description={`People who can sign in to ${schoolName}. Remove anyone who should no longer have access, such as staff who have left.`}
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="space-y-6 px-6 py-5">
        {members.error && <ErrorBanner message={members.error.message} />}
        {members.isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {members.data &&
          groups.map(([title, rows]) => (
            <section key={title}>
              <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{title} ({rows.length})</h3>
              {rows.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400 italic">None yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {rows.map((m) => (
                    <MemberRow key={m.userId} member={m} schoolId={schoolId} callerIsOwner={callerIsOwner} onChanged={() => client.invalidateQueries({ queryKey: key })} />
                  ))}
                </ul>
              )}
            </section>
          ))}
      </div>
    </Dialog>
  )
}

function MemberRow({ member: m, schoolId, callerIsOwner, onChanged }: { member: Member; schoolId: string; callerIsOwner: boolean; onChanged: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const removed = m.status === 'REVOKED'
  const locked = m.isOwner ? "The school's owner can't be removed" : m.isYou ? "You can't remove yourself" : m.role === 'ADMIN' && !callerIsOwner ? 'Only the school owner can remove an admin' : null

  async function act(action: 'revoke' | 'restore') {
    setBusy(true)
    setError(null)
    try {
      await api(`/schools/${schoolId}/members/${m.userId}/${action}`, { method: 'POST' })
      await onChanged()
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this member')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className={`flex flex-wrap items-center gap-2 font-semibold ${removed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {m.fullName}
            {m.isOwner && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-700 no-underline">OWNER</span>}
            {m.isYou && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">YOU</span>}
            {removed && <span className="rounded bg-red-50 px-1.5 text-[10px] font-bold text-red-600">REMOVED</span>}
          </p>
          <p className="truncate text-xs text-slate-500">{m.email}</p>
        </div>
        {removed ? (
          <button type="button" onClick={() => void act('restore')} disabled={busy || (m.role === 'ADMIN' && !callerIsOwner)} className={`${btnSecondary} h-9 text-xs`} title="They can join again with a current invite code">
            <UserPlus className="size-3.5" /> Allow to rejoin
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy || confirming || !!locked} title={locked ?? undefined} className={`${btnSecondary} h-9 text-xs text-red-600`}>
            <UserMinus className="size-3.5" /> Remove
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <span>{m.fullName} loses access at once and can't rejoin with the invite code.{m.role === 'TEACHER' ? ' Their teacher profile is marked inactive.' : ''}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={`${btnSecondary} h-9 text-xs`}>Cancel</button>
            <button type="button" onClick={() => void act('revoke')} disabled={busy} className={`${btnDanger} h-9 text-xs`}>{busy ? 'Removing…' : 'Remove'}</button>
          </span>
        </div>
      )}
      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
    </li>
  )
}
