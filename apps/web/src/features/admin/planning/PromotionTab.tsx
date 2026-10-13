import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleX, Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary } from '@/components/ui/formStyles'
import { formatDate } from '@/features/portal/format'
import { useAdminContext } from '../adminContext'

type Overview = {
  checkedAt: string
  pending: {
    academicYear: string
    boundaryDate: string
    studentsTracked: boolean
    rows: { fromClass: string; toClass: string; students: number }[]
    heldNewAdmissions: number
    class12Excluded: number
    /** No class set, or the next class isn't offered by the school. */
    notPromoted: number
  } | null
  history: { id: string; academicYear: string; boundaryDate: string; status: 'CONFIRMED' | 'DISMISSED'; studentCount: number; decidedAt: string }[]
}

export function PromotionTab() {
  const { schoolId } = useAdminContext()
  const { data, error, isPending, refetch, isFetching } = useQuery({
    queryKey: [schoolId, 'promotion'],
    queryFn: () => api<Overview>(`/schools/${schoolId}/promotion`),
  })
  const [decision, setDecision] = useState<'confirm' | 'dismiss' | null>(null)
  const pending = data?.pending

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Checked automatically once a day. You can also check on demand.
          {data && <span className="ml-1 text-xs text-slate-400">Last checked {new Date(data.checkedAt).toLocaleTimeString()}.</span>}
        </p>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className={btnSecondary}>
          <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} /> Check for promotion now
        </button>
      </div>

      <div className="mt-6 space-y-6">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}

        {pending ? (
          <section className="rounded-2xl border border-amber-300 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Class Promotion Ready: {pending.academicYear}</h2>
            <p className="mt-1 text-sm text-slate-600">Boundary date {pending.boundaryDate}. Review before confirming.</p>
            <table className="mt-5 w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-700">
                <tr>
                  <th className="py-2 font-semibold">From Class</th>
                  <th className="py-2 font-semibold">To Class</th>
                  <th className="py-2 font-semibold">Students</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.rows.map((r) => (
                  <tr key={r.fromClass}>
                    <td className="py-2">{r.fromClass}</td>
                    <td className="py-2">{r.toClass}</td>
                    <td className="py-2">{r.students}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pending.studentsTracked && (
              <p className="mt-3 text-xs text-slate-500">
                There are no student records yet, so there is nobody to promote. Each year can only be decided once, so Confirm unlocks when students exist; you can dismiss this cycle in the meantime.
              </p>
            )}
            <p className="mt-3 text-xs text-slate-600">{pending.heldNewAdmissions} new admissions held to next year.</p>
            <p className="text-xs text-slate-600">{pending.class12Excluded} Class 12 students excluded — handle manually.</p>
            {pending.notPromoted > 0 && (
              <p className="text-xs text-slate-600">
                {pending.notPromoted} student{pending.notPromoted === 1 ? '' : 's'} stay in place: no class set, or the next class isn’t offered by this school.
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setDecision('confirm')}
                disabled={!pending.studentsTracked}
                title={pending.studentsTracked ? undefined : 'Available once student records exist'}
                className={`${btnPrimary} disabled:cursor-not-allowed`}
              >
                <CircleCheck className="size-4" /> Confirm Promotion
              </button>
              <button type="button" onClick={() => setDecision('dismiss')} className={btnSecondary}>
                <CircleX className="size-4" /> Dismiss
              </button>
            </div>
          </section>
        ) : (
          data && (
            <p className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600">
              No promotion pending. The next cycle opens at the start of the next academic year.
            </p>
          )
        )}

        <section>
          <h2 className="text-base font-bold text-slate-900">History</h2>
          {data?.history.length === 0 && <p className="mt-2 text-sm text-slate-400">No past promotion cycles yet.</p>}
          <ul className="mt-3 space-y-2">
            {data?.history.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <span className="font-semibold text-slate-900">{c.academicYear}</span>
                <span className="text-xs text-slate-500">Boundary {c.boundaryDate} · decided {formatDate(c.decidedAt)}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                    c.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {c.status === 'CONFIRMED' ? `Promoted ${c.studentCount}` : 'Dismissed'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {decision && pending && (
        <ConfirmDialog
          title={decision === 'confirm' ? `Confirm promotion for ${pending.academicYear}?` : `Dismiss ${pending.academicYear} promotion?`}
          message={
            decision === 'confirm'
              ? 'This is recorded once per academic year and can’t be run again.'
              : 'No students are moved. This year’s cycle is closed and won’t be offered again.'
          }
          confirmLabel={decision === 'confirm' ? 'Confirm Promotion' : 'Dismiss'}
          onConfirm={async () => {
            await api(`/schools/${schoolId}/promotion/${decision}`, {
              method: 'POST',
              body: JSON.stringify({ academicYear: pending.academicYear }),
            })
            await refetch()
          }}
          onClose={() => setDecision(null)}
        />
      )}
    </>
  )
}
