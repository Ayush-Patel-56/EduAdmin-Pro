import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { formatDate } from '@/features/portal/format'
import { JOB_STATUS_LABELS, JOB_STATUS_STYLES, useMySchools, useRecruitmentOptions, useRecruitmentWrite, useRequirements, type Requirement } from './api'
import { DepartmentFilter, RowActions, Toolbar } from './shared'
import { useDebounced } from './useDebounced'

export function RequirementsTab({ onEdit }: { onEdit: (item: Requirement) => void }) {
  const { data: options } = useRecruitmentOptions()
  const { data: schools } = useMySchools()
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const q = useDebounced(search)
  const { data: rows, error, isPending } = useRequirements({ q, department })
  const write = useRecruitmentWrite()
  const [deleting, setDeleting] = useState<Requirement | null>(null)
  const manySchools = (schools?.length ?? 0) > 1

  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search role, subject, department...">
        <DepartmentFilter value={department} onChange={setDepartment} departments={options?.departments ?? []} />
      </Toolbar>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] font-bold tracking-wider text-slate-700 uppercase">
            <tr>
              <th className="px-5 py-3.5">Job Title &amp; Program</th>
              <th className="px-5 py-3.5">Department</th>
              <th className="px-5 py-3.5">Experience &amp; Qual</th>
              <th className="px-5 py-3.5">Vacancies</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5">Posting / Closing</th>
              <th className="px-5 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && (
              <tr><td colSpan={7} className="py-10"><Loader2 className="mx-auto size-5 animate-spin text-slate-300" aria-label="Loading" /></td></tr>
            )}
            {error && <tr><td colSpan={7} className="p-4"><ErrorBanner message={error.message} /></td></tr>}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-600">
                  {q || department ? 'No job requirements match these filters.' : 'No job requirements found. Click "Add Requirement" to create your first vacancy.'}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id} className="align-top hover:bg-slate-50/60">
                <td className="px-5 py-3.5">
                  <p className="font-semibold text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-500">{r.subject}{manySchools && ` · ${r.schoolName}`}</p>
                </td>
                <td className="px-5 py-3.5 text-slate-700">{r.department}</td>
                <td className="px-5 py-3.5 text-xs text-slate-600">
                  <p>{r.experience ?? '—'}</p>
                  <p className="text-slate-400">{r.qualification ?? ''}</p>
                </td>
                <td className="px-5 py-3.5 font-semibold text-slate-900">{r.vacancies}</td>
                <td className="px-5 py-3.5">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${JOB_STATUS_STYLES[r.status]}`}>{JOB_STATUS_LABELS[r.status]}</span>
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-600">
                  <p>{r.postingDate ? formatDate(r.postingDate) : '—'}</p>
                  <p className="text-slate-400">{r.closingDate ? `Closes ${formatDate(r.closingDate)}` : 'No closing date'}</p>
                </td>
                <td className="px-5 py-3.5">
                  <RowActions label={r.title} onEdit={() => onEdit(r)} onDelete={() => setDeleting(r)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete job requirement?"
          message={<><strong className="text-slate-900">{deleting.title}</strong> will be removed. The deletion is recorded in the audit log.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await write(`/requirements/${deleting.id}`, 'DELETE')
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
