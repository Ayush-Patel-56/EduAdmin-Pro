import { useEffect, useState } from 'react'
import { Ban, Filter, Layers, Pencil, Plus, RotateCcw, Search, Trash2, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { formatDay } from '@/features/portal/format'
import { durationLabel, PHASE_LABELS, TEST_TYPE_LABELS, time12, useInvalidateAssessments, useTests, type Options, type Test, type TestFilters } from './api'
import { TestDialog } from './TestDialog'
import { Card, Empty, FilterSelect, iconBtn, Pager, PhaseBadge, Spinner, tdClass, TestTypeBadge, thClass } from './ui'

const PAGE_SIZE = 20

type Props = {
  base: string
  options: Options
  variant: 'admin' | 'faculty'
  /** The signed-in teacher's faculty id: they edit, cancel and delete the tests they created. */
  facultyId?: string | null
  onOpen: (id: string) => void
}

/** All Tests (PRD 4.10) and the faculty Tests tab (PRD 5.11). */
export function TestsTable({ base, options, variant, facultyId, onOpen }: Props) {
  const admin = variant === 'admin'
  const [filters, setFilters] = useState<TestFilters>({ page: 1, pageSize: PAGE_SIZE })
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === (search.trim() || undefined) ? f : { ...f, q: search.trim() || undefined, page: 1 })), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useTests(base, filters)
  const invalidate = useInvalidateAssessments(base)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Test | null>(null)
  const [confirm, setConfirm] = useState<{ test: Test; action: 'cancel' | 'restore' | 'delete' } | null>(null)
  const set = (key: keyof TestFilters, value: string) => setFilters((f) => ({ ...f, [key]: value || undefined, page: 1 }))
  const data = list.data
  const mine = (t: Test) => admin || (options.active && !!facultyId && t.faculty.id === facultyId)
  const filtered = !!(filters.q || filters.batchId || filters.programId || filters.author || filters.type || filters.status)

  return (
    <Card>
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{admin ? 'All Tests' : 'Tests'}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{admin ? 'Every test scheduled in the school.' : 'Tests of your batches. Open one to build its paper or enter results.'}</p>
          </div>
          {options.active && (
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover">
              <Plus className="size-4" /> {admin ? 'Schedule Test' : 'Create Test'}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tests, subjects, batches…"
              aria-label="Search tests"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            />
          </div>
          {admin ? (
            <>
              <FilterSelect label="Faculty" icon={UserRound} all="All Faculty" value={filters.author ?? ''} options={[{ value: 'admin', label: 'Admins' }, ...options.faculty.map((f) => ({ value: f.id, label: f.name }))]} onChange={(v) => set('author', v)} />
              <FilterSelect label="Program" icon={Layers} all="All Programs" value={filters.programId ?? ''} options={options.programs.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => set('programId', v)} />
            </>
          ) : (
            <FilterSelect label="Batch" icon={Layers} all="All Batches" value={filters.batchId ?? ''} options={options.batches.map((b) => ({ value: b.id, label: b.name }))} onChange={(v) => set('batchId', v)} />
          )}
          <FilterSelect label="Type" icon={Filter} all="All Types" value={filters.type ?? ''} options={options.testTypes.map((t) => ({ value: t, label: TEST_TYPE_LABELS[t] }))} onChange={(v) => set('type', v)} />
          <FilterSelect label="Status" all="All Statuses" value={filters.status ?? ''} options={(['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const).map((p) => ({ value: p, label: PHASE_LABELS[p] }))} onChange={(v) => set('status', v)} />
        </div>
      </div>

      {list.error && (
        <div className="p-4">
          <ErrorBanner message={list.error.message} />
        </div>
      )}
      {!data && !list.error ? (
        <Spinner />
      ) : data && !data.items.length ? (
        <Empty>{filtered ? 'No tests match these filters.' : admin ? 'No tests scheduled yet.' : 'No tests for your batches yet.'}</Empty>
      ) : (
        data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={thClass}>{admin ? 'Title' : 'Name'}</th>
                  {admin && <th className={thClass}>Faculty</th>}
                  <th className={thClass}>Batch</th>
                  {admin ? <th className={thClass}>Program</th> : <th className={thClass}>Type</th>}
                  <th className={thClass}>{admin ? 'Date' : 'Date & Time'}</th>
                  {!admin && <th className={thClass}>Duration</th>}
                  {!admin && <th className={thClass}>Total Marks</th>}
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/50">
                    <td className={tdClass}>
                      <button type="button" onClick={() => onOpen(t.id)} className="text-left font-semibold text-slate-900 hover:text-indigo-700 hover:underline">
                        {t.title}
                      </button>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {t.subject}
                        {admin && ` · ${TEST_TYPE_LABELS[t.type]}`} · {t.questions ? `${t.questions} question${t.questions === 1 ? '' : 's'}` : 'No paper'} · {t.results} graded
                      </span>
                    </td>
                    {admin && (
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {t.faculty.name}
                        {!t.faculty.id && <span className="block text-[11px] text-slate-400">Admin</span>}
                      </td>
                    )}
                    <td className={`${tdClass} whitespace-nowrap`}>{t.batch.name}</td>
                    {admin ? (
                      <td className={`${tdClass} whitespace-nowrap`}>{t.program.name}</td>
                    ) : (
                      <td className={tdClass}>
                        <TestTypeBadge value={t.type} />
                      </td>
                    )}
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {formatDay(t.date)}
                      <span className="block text-[11px] text-slate-400">{time12(t.time)}</span>
                    </td>
                    {!admin && <td className={`${tdClass} whitespace-nowrap`}>{durationLabel(t.durationMinutes)}</td>}
                    {!admin && <td className={`${tdClass} tabular-nums`}>{t.totalMarks}</td>}
                    <td className={tdClass}>
                      <PhaseBadge value={t.phase} />
                    </td>
                    <td className={`${tdClass} text-right whitespace-nowrap`}>
                      <button type="button" onClick={() => onOpen(t.id)} className="mr-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        {t.phase === 'COMPLETED' || t.phase === 'ONGOING' ? 'Results' : 'Open'}
                      </button>
                      {mine(t) && (
                        <>
                          <button type="button" aria-label="Edit test" title="Edit" onClick={() => setEditing(t)} className={iconBtn}>
                            <Pencil className="size-4" />
                          </button>
                          {t.phase === 'CANCELLED' ? (
                            <button type="button" aria-label="Restore test" title="Restore" onClick={() => setConfirm({ test: t, action: 'restore' })} className={iconBtn}>
                              <RotateCcw className="size-4" />
                            </button>
                          ) : (
                            <button type="button" aria-label="Cancel test" title="Cancel test" onClick={() => setConfirm({ test: t, action: 'cancel' })} className={`${iconBtn} hover:text-amber-600`}>
                              <Ban className="size-4" />
                            </button>
                          )}
                          <button type="button" aria-label="Delete test" title="Delete" onClick={() => setConfirm({ test: t, action: 'delete' })} className={`${iconBtn} hover:text-red-600`}>
                            <Trash2 className="size-4" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setFilters((f) => ({ ...f, page }))} noun="tests" />}

      {creating && <TestDialog base={base} options={options} test={null} title={admin ? 'Schedule New Test' : 'Create Scheduled Test'} onSaved={invalidate} onClose={() => setCreating(false)} />}
      {editing && <TestDialog base={base} options={options} test={editing} title="Edit Test" onSaved={invalidate} onClose={() => setEditing(null)} />}
      {confirm && <TestActionConfirm base={base} test={confirm.test} action={confirm.action} onDone={invalidate} onClose={() => setConfirm(null)} />}
    </Card>
  )
}

/** Cancel, restore or delete a test, after confirming. */
export function TestActionConfirm({ base, test, action, onDone, onClose }: { base: string; test: Test; action: 'cancel' | 'restore' | 'delete'; onDone: () => Promise<unknown> | void; onClose: () => void }) {
  const copy = {
    cancel: { title: 'Cancel test?', label: 'Cancel Test', message: 'It stays on record as cancelled, with any results entered. You can restore it later.' },
    restore: { title: 'Restore test?', label: 'Restore', message: 'It goes back on the schedule.' },
    delete: { title: 'Delete test?', label: 'Delete', message: 'The test and its paper are removed. A test with results can’t be deleted; cancel it instead.' },
  }[action]
  return (
    <ConfirmDialog
      title={copy.title}
      message={
        <>
          <p className="font-semibold text-slate-800">
            {test.title} · {test.batch.name} · {formatDay(test.date)}
          </p>
          <p className="mt-2">{copy.message}</p>
        </>
      }
      confirmLabel={copy.label}
      onConfirm={async () => {
        if (action === 'delete') await api(`${base}/tests/${test.id}`, { method: 'DELETE' })
        else await api(`${base}/tests/${test.id}/status`, { method: 'PATCH', body: JSON.stringify({ cancelled: action === 'cancel' }) })
        await onDone()
      }}
      onClose={onClose}
    />
  )
}
