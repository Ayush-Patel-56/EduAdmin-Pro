import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Loader2, RefreshCw } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnDanger, btnPrimary, btnSecondary } from '@/components/ui/formStyles'
import { createLink, feedbackLinkUrl, regenerateLink, setLinkActive, useFeedbackLinks, type FeedbackLinkRow } from '@/features/feedback/api'

type Props = { schoolId: string; onClose: () => void }

/**
 * Student feedback links, one per batch. A student opens their batch's link,
 * picks their name and a teacher, and rates them; it shows here under
 * Student → Teacher. Switching a link off or replacing it stops it at once.
 */
export function FeedbackLinksDialog({ schoolId, onClose }: Props) {
  const links = useFeedbackLinks(schoolId)
  const programs = new Map<string, FeedbackLinkRow[]>()
  for (const row of links.data ?? []) programs.set(row.programName, [...(programs.get(row.programName) ?? []), row])

  return (
    <Dialog
      title="Student feedback links"
      description="Share a batch's link with its students. They pick their name and a teacher; teachers see the feedback without the student's name."
      onClose={onClose}
      widthClass="max-w-2xl"
    >
      <div className="space-y-6 px-6 py-5">
        {links.error && <ErrorBanner message={links.error.message} />}
        {links.isPending && <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>}
        {links.data?.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Add a batch first: each batch gets its own link.</p>}
        {[...programs].map(([program, rows]) => (
          <section key={program}>
            <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{program}</h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {rows.map((row) => <LinkItem key={row.batchId} row={row} schoolId={schoolId} />)}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

function LinkItem({ row, schoolId }: { row: FeedbackLinkRow; schoolId: string }) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const url = row.token ? feedbackLinkUrl(row.token) : null

  async function run(change: () => Promise<FeedbackLinkRow>) {
    setBusy(true)
    setError(null)
    try {
      const updated = await change()
      client.setQueryData<FeedbackLinkRow[]>([schoolId, 'feedback', 'links'], (rows) => rows?.map((r) => (r.batchId === updated.batchId ? updated : r)))
      setConfirmReplace(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the link')
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the link and copy it yourself.')
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{row.batchName}</p>
          {url ? (
            <p className={`mt-0.5 truncate font-mono text-[11px] ${row.active ? 'text-slate-500' : 'text-slate-400 line-through'}`} title={url}>{url}</p>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-400">No link yet</p>
          )}
        </div>
        {!url ? (
          <button type="button" onClick={() => void run(() => createLink(schoolId, row.batchId))} disabled={busy} className={btnPrimary}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Create link
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void copy()} disabled={!row.active} className={btnSecondary} title={row.active ? undefined : 'Switch the link on to share it'}>
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={row.active}
              aria-label={`${row.batchName} link ${row.active ? 'on' : 'off'}`}
              onClick={() => void run(() => setLinkActive(schoolId, row.batchId, !row.active))}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${row.active ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${row.active ? 'left-4.5' : 'left-0.5'}`} />
              </span>
              {row.active ? 'On' : 'Off'}
            </button>
            <button type="button" onClick={() => setConfirmReplace(true)} disabled={busy || confirmReplace} className={btnSecondary}>
              <RefreshCw className="size-4" /> Replace link
            </button>
          </div>
        )}
      </div>
      {confirmReplace && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <span>The old link will stop working. Students will need the new one.</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setConfirmReplace(false)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button type="button" onClick={() => void run(() => regenerateLink(schoolId, row.batchId))} disabled={busy} className={btnDanger}>
              {busy ? 'Replacing…' : 'Replace link'}
            </button>
          </span>
        </div>
      )}
      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
    </li>
  )
}
