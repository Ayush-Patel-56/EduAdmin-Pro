import { useState } from 'react'
import { Eye, Loader2, Shield } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { useAuditLog, type AuditEvent } from './api'
import { EmptyRow, Pill } from './shared'

const ACTION_STYLES = {
  CREATE: 'bg-emerald-50 text-emerald-700',
  UPDATE: 'bg-sky-50 text-sky-700',
  DELETE: 'bg-red-50 text-red-700',
} as const

const ENTITY_LABELS: Record<string, string> = {
  JobRequirement: 'Job Requirement',
  Candidate: 'Candidate',
  Interview: 'Interview',
  TeacherAppraisal: 'Teacher Appraisal',
  Faculty: 'Faculty',
  School: 'School',
}

/** Read-only view of the append-only audit table (the database rejects edits). */
export function AuditTab() {
  const { data, error, isPending } = useAuditLog()
  const [viewing, setViewing] = useState<AuditEvent | null>(null)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Shield className="size-5 text-blue-600" /> Immutable System Audit Trail</h2>
          <p className="text-xs text-slate-500">Every recruitment and appraisal create, update and delete. Records can’t be edited or removed.</p>
        </div>
        <span className="self-start rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
          {data?.total ?? 0} Events Logged
        </span>
      </div>

      <div className="mt-5 overflow-x-auto">
        <ErrorBanner message={error?.message} />
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold tracking-wider text-slate-700 uppercase">
            <tr>
              <th className="px-4 py-3">Action Type</th>
              <th className="px-4 py-3">Table &amp; Record ID</th>
              <th className="px-4 py-3">Author</th>
              <th className="px-4 py-3">IP Address &amp; Agent</th>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && <tr><td colSpan={6} className="py-10"><Loader2 className="mx-auto size-5 animate-spin text-slate-300" aria-label="Loading" /></td></tr>}
            {data?.events.length === 0 && <EmptyRow colSpan={6}>No audit logs recorded yet. Any create, update, or delete action will appear here in real time.</EmptyRow>}
            {data?.events.map((e) => (
              <tr key={e.id} className="align-top hover:bg-slate-50/60">
                <td className="px-4 py-3"><Pill className={ACTION_STYLES[e.action]}>{e.action}</Pill></td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{ENTITY_LABELS[e.entity] ?? e.entity}</p>
                  <p className="font-mono text-[11px] text-slate-400" title={e.recordId}>{e.recordId.slice(0, 8)}…</p>
                  <p className="mt-0.5 max-w-sm text-xs text-slate-600">{e.summary}</p>
                </td>
                <td className="px-4 py-3 text-slate-800">
                  {e.actorName}
                  {e.schoolName && <p className="text-[11px] text-slate-400">{e.schoolName}</p>}
                </td>
                <td className="max-w-60 px-4 py-3 text-xs text-slate-600">
                  <p className="font-mono">{e.ip ?? '—'}</p>
                  <p className="truncate text-slate-400" title={e.userAgent ?? ''}>{e.userAgent ?? 'System action'}</p>
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-700">
                  {new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => setViewing(e)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    <Eye className="size-3.5" /> Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.total > data.events.length && (
          <p className="mt-3 text-center text-xs text-slate-400">Showing the latest {data.events.length} of {data.total} events.</p>
        )}
      </div>

      {viewing && <AuditDetails event={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}

function AuditDetails({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  const entries = Object.entries(event.changes ?? {})
  const isDiff = event.action === 'UPDATE'
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
  return (
    <Dialog title={`${event.action} · ${ENTITY_LABELS[event.entity] ?? event.entity}`} description={event.summary} onClose={onClose} widthClass="max-w-2xl">
      <div className="space-y-4 px-6 py-5 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-slate-500">Record ID</dt><dd className="font-mono break-all text-slate-800">{event.recordId}</dd>
          <dt className="text-slate-500">Author</dt><dd className="text-slate-800">{event.actorName}</dd>
          <dt className="text-slate-500">When</dt><dd className="text-slate-800">{new Date(event.createdAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'medium' })}</dd>
          <dt className="text-slate-500">IP address</dt><dd className="font-mono text-slate-800">{event.ip ?? '—'}</dd>
          <dt className="text-slate-500">User agent</dt><dd className="break-all text-slate-800">{event.userAgent ?? 'System action'}</dd>
        </dl>
        {entries.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Field</th>
                {isDiff ? (<><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th></>) : <th className="px-3 py-2">Value</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map(([field, value]) => {
                const pair = isDiff && Array.isArray(value) ? value : null
                return (
                  <tr key={field}>
                    <td className="px-3 py-2 font-medium text-slate-700">{field}</td>
                    {pair ? (
                      <>
                        <td className="px-3 py-2 break-all text-red-700">{show(pair[0])}</td>
                        <td className="px-3 py-2 break-all text-emerald-700">{show(pair[1])}</td>
                      </>
                    ) : (
                      <td className="px-3 py-2 break-all text-slate-800">{show(value)}</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  )
}
