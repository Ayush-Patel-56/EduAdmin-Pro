import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { formatDate } from '@/features/portal/format'
import {
  APPRAISAL_STATUS_LABELS,
  APPRAISAL_STATUS_STYLES,
  BADGE_LABELS,
  BADGE_STYLES,
  PERIOD_LABELS,
  useAppraisals,
  useRecruitmentOptions,
  useRecruitmentWrite,
  type Appraisal,
} from './api'
import { DepartmentFilter, Pill, RowActions, Stars, Toolbar } from './shared'
import { useDebounced } from './useDebounced'

export function AppraisalsTab({ onEdit }: { onEdit: (item: Appraisal) => void }) {
  const { data: options } = useRecruitmentOptions()
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const q = useDebounced(search)
  const { data: rows, error, isPending } = useAppraisals({ q, department })
  const write = useRecruitmentWrite()
  const [deleting, setDeleting] = useState<Appraisal | null>(null)

  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search teacher, appraiser, department...">
        <DepartmentFilter value={department} onChange={setDepartment} departments={options?.departments ?? []} />
      </Toolbar>

      <div className="mt-4">
        <ErrorBanner message={error?.message} />
        {isPending ? (
          <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : rows?.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-600 shadow-sm">
            {q || department ? 'No appraisals match these filters.' : 'No teacher appraisals found. Click "New Appraisal" to begin performance review cycles.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] font-bold tracking-wider text-slate-700 uppercase">
                <tr>
                  <th className="px-5 py-3.5">Teacher</th>
                  <th className="px-5 py-3.5">Period &amp; Year</th>
                  <th className="px-5 py-3.5">Teaching</th>
                  <th className="px-5 py-3.5">Punctuality</th>
                  <th className="px-5 py-3.5">Student Avg</th>
                  <th className="px-5 py-3.5">Overall</th>
                  <th className="px-5 py-3.5">Review Status</th>
                  <th className="px-5 py-3.5">Appraiser</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows?.map((a) => (
                  <tr key={a.id} className="align-top hover:bg-slate-50/60">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-900">{a.faculty.name}</p>
                      <p className="text-xs text-slate-500">{[a.department, a.faculty.subjects.join(', ')].filter(Boolean).join(' · ') || '—'}</p>
                      <p className="text-[11px] text-slate-400">{a.schoolName}</p>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-700">
                      <p>{PERIOD_LABELS[a.period]}</p>
                      <p className="text-slate-400">{a.academicYear}</p>
                    </td>
                    <td className="px-5 py-3.5"><Stars value={a.teachingScore} /></td>
                    <td className="px-5 py-3.5"><Stars value={a.punctualityScore} /></td>
                    <td className="px-5 py-3.5 text-xs text-slate-500" title="Filled automatically from test results">
                      {a.studentAvg === null ? 'Awaiting results' : `${a.studentAvg}%`}
                    </td>
                    <td className="px-5 py-3.5">{a.overallBadge ? <Pill className={BADGE_STYLES[a.overallBadge]}>{BADGE_LABELS[a.overallBadge]}</Pill> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-5 py-3.5"><Pill className={APPRAISAL_STATUS_STYLES[a.status]}>{APPRAISAL_STATUS_LABELS[a.status]}</Pill></td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">
                      <p>{a.appraiserName ?? '—'}</p>
                      <p className="text-slate-400">Updated {formatDate(a.updatedAt)}</p>
                    </td>
                    <td className="px-5 py-3.5"><RowActions label={`appraisal of ${a.faculty.name}`} onEdit={() => onEdit(a)} onDelete={() => setDeleting(a)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete appraisal?"
          message={<>The {PERIOD_LABELS[deleting.period].toLowerCase()} appraisal of <strong className="text-slate-900">{deleting.faculty.name}</strong> ({deleting.academicYear}) will be removed. The deletion is recorded in the audit log.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await write(`/appraisals/${deleting.id}`, 'DELETE')
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
