import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { formatDay } from '@/features/portal/format'
import {
  allDues,
  CATEGORY_LABELS,
  feesPath,
  FREQUENCY_LABELS,
  inr,
  METHOD_LABELS,
  periodLabel,
  STATUS_LABELS,
  STATUS_STYLE,
  useDues,
  useFeeOptions,
  useFeeStructures,
  useFeeSummary,
  useInvalidateFees,
  type Due,
  type FeeCategory,
  type FeeStatus,
  type FeeStructure,
} from '@/features/fees/api'
import { useAdminContext } from '../adminContext'
import { AssessDialog, DueDialog, RecordPaymentDialog, StructureDialog } from './FeeDialogs'
import { FeeImportDialog, type FeeSchema } from './FeeImportDialog'
import { exportDues, exportStructures } from './feeExport'

const PAGE = 10
type Tab = 'structures' | 'payments'

/** Fee Management (PRD 4.9): admins only. Fees are recorded here; nothing is collected online. */
export function FeesPage() {
  const { schoolId, dashboard } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'payments' ? 'payments' : 'structures'
  const summary = useFeeSummary(schoolId)
  const invalidate = useInvalidateFees(schoolId)
  const [importing, setImporting] = useState<FeeSchema | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const s = summary.data

  // Counts for the tab labels come from unfiltered lists.
  const structureCount = useFeeStructures(schoolId, { q: '', category: '' }).data?.length
  const dueCount = useDues(schoolId, { q: '', status: '', page: 1 }).data?.total

  async function refresh() {
    setRefreshing(true)
    await invalidate()
    setRefreshing(false)
  }

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Fee Management</h1>
          <p className="mt-1 text-sm text-slate-500">Manage Fee Types, Financial Details, Scope &amp; Relations, Student Records, and Transaction Logistics</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setImporting(tab)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
            <FileSpreadsheet className="size-4" /> Upload from Excel
          </button>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {summary.error && <div className="mt-4"><ErrorBanner message={summary.error.message} /></div>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Collected This Month" icon={CreditCard} iconClass="bg-emerald-50 text-emerald-600" value={s ? inr(s.collectedThisMonthPaise) : '—'} note={s ? `Total All-Time: ${inr(s.collectedAllTimePaise)}` : ''} />
        <Kpi label="Pending Dues" icon={Clock} iconClass="bg-amber-50 text-amber-500" value={s ? inr(s.pendingPaise) : '—'} note={s ? `Across ${s.pendingStudents} student${s.pendingStudents === 1 ? '' : 's'}` : ''} noteClass="text-amber-700" />
        <Kpi label="Overdue Accounts" icon={AlertTriangle} iconClass="bg-red-50 text-red-500" value={s ? String(s.overdueAccounts) : '—'} note={s ? (s.overdueAccounts ? 'Students past a due date with money owed' : 'No overdue accounts') : ''} noteClass={s?.overdueAccounts ? 'text-red-600' : undefined} />
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Collection Rate</p>
            <p className="mt-3 text-2xl font-bold text-slate-900">{s?.collectionRate == null ? '—' : `${s.collectionRate}%`}</p>
            <p className="mt-1 text-xs text-slate-500">{s ? (s.dueCount ? `Of ${s.dueCount} due${s.dueCount === 1 ? '' : 's'} billed` : 'Nothing billed yet') : ''}</p>
          </div>
          <Ring percent={s?.collectionRate ?? null} />
        </div>
      </div>

      <div role="tablist" className="mt-8 flex gap-6 border-b border-slate-200">
        {(
          [
            ['structures', 'Fee Structure & Scope', Layers, structureCount],
            ['payments', 'Fee Payments & Transactions', FileText, dueCount],
          ] as const
        ).map(([key, text, Icon, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'structures' ? {} : { tab: key }, { replace: true })}
            className={`-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm font-bold transition ${tab === key ? 'border-ink text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'}`}
          >
            <Icon className="size-4" /> {text} ({count ?? '…'})
          </button>
        ))}
      </div>

      {tab === 'structures' ? (
        <StructuresTab schoolId={schoolId} schoolName={dashboard?.school.name ?? 'school'} yearStartMonth={dashboard?.school.academicYearStartMonth ?? 4} onImport={() => setImporting('structures')} />
      ) : (
        <PaymentsTab schoolId={schoolId} schoolName={dashboard?.school.name ?? 'school'} onImport={() => setImporting('payments')} />
      )}

      {importing && <FeeImportDialog schoolId={schoolId} initial={importing} onImported={invalidate} onClose={() => setImporting(null)} />}
    </>
  )
}

function Kpi({ label, icon: Icon, iconClass, value, note, noteClass }: { label: string; icon: typeof Clock; iconClass: string; value: string; note: string; noteClass?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</p>
        <span className={`flex size-9 items-center justify-center rounded-xl ${iconClass}`}><Icon className="size-4" /></span>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
      <p className={`mt-1 text-xs ${noteClass ?? 'text-slate-500'}`}>{note}</p>
    </div>
  )
}

function Ring({ percent }: { percent: number | null }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 56 56" className="size-16" role="img" aria-label={percent === null ? 'No collection rate yet' : `${percent}% collected`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
      {percent !== null && (
        <circle cx="28" cy="28" r={r} fill="none" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(Math.min(percent, 100) / 100) * c} ${c}`} transform="rotate(-90 28 28)" />
      )}
      <text x="28" y="31" textAnchor="middle" className="fill-slate-900 text-[10px] font-bold">{percent === null ? '—' : `${Math.round(percent)}%`}</text>
    </svg>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">{children}</div>
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-80">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:outline-none" />
    </div>
  )
}

function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: ReactNode }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
      <Filter className="size-4 text-slate-400" />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent focus:outline-none">{children}</select>
    </label>
  )
}

function ActionButtons({ onExport, onImport, primary, onPrimary, canExport }: { onExport: () => void; onImport: () => void; primary: string; onPrimary: () => void; canExport: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={onExport} disabled={!canExport} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        <Download className="size-4" /> Export
      </button>
      <button type="button" onClick={onImport} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-50 px-4 text-sm font-semibold text-indigo-700 hover:bg-emerald-100">
        <FileSpreadsheet className="size-4 text-emerald-600" /> Upload Excel
      </button>
      <button type="button" onClick={onPrimary} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-hover">
        <Plus className="size-4" /> {primary}
      </button>
    </div>
  )
}

function Pager({ page, pages, total, noun, onPage }: { page: number; pages: number; total: number; noun: string; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
      <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
        Showing {total ? (page - 1) * PAGE + 1 : 0}-{Math.min(page * PAGE, total)} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-50"><ChevronLeft className="size-3.5" /> Previous</button>
        <span className="flex size-8 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">{page}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-50">Next <ChevronRight className="size-3.5" /></button>
      </div>
    </div>
  )
}

function Empty({ icon: Icon, title, text }: { icon: typeof Layers; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <Icon className="size-10 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">{text}</p>
    </div>
  )
}

const th = 'px-5 py-3.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase'

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 250)
    return () => clearTimeout(t)
  }, [value])
  return debounced
}

function StructuresTab({ schoolId, schoolName, yearStartMonth, onImport }: { schoolId: string; schoolName: string; yearStartMonth: number; onImport: () => void }) {
  const { structure: academic } = useAdminContext()
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const list = useFeeStructures(schoolId, { q, category })
  const invalidate = useInvalidateFees(schoolId)
  const [dialog, setDialog] = useState<{ kind: 'form'; structure?: FeeStructure } | { kind: 'assess'; structure: FeeStructure } | { kind: 'delete'; structure: FeeStructure } | { kind: 'export' } | null>(null)
  const rows = list.data ?? []
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages)

  return (
    <>
      <Toolbar>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search fee name, type, batch, program..." />
          <FilterSelect label="Fee type" value={category} onChange={(v) => { setCategory(v); setPage(1) }}>
            <option value="">All Fee Types</option>
            {(Object.keys(CATEGORY_LABELS) as FeeCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </FilterSelect>
        </div>
        <ActionButtons canExport={rows.length > 0} onExport={() => setDialog({ kind: 'export' })} onImport={onImport} primary="Create Fee Structure" onPrimary={() => setDialog({ kind: 'form' })} />
      </Toolbar>

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Fee Type &amp; Name</th>
                <th className={th}>Financial Details</th>
                <th className={th}>Scope &amp; Relations</th>
                <th className={th}>Mandatory</th>
                <th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * PAGE, current * PAGE).map((s) => (
                <tr key={s.id} className="border-b border-slate-50 align-top text-sm last:border-0">
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-700 uppercase">{CATEGORY_LABELS[s.category]}</span>
                    <p className="mt-1.5 font-semibold text-slate-900">{s.name}</p>
                    {s.description && <p className="max-w-72 truncate text-xs text-slate-500" title={s.description}>{s.description}</p>}
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-bold text-slate-900">{inr(s.amountPaise)}</p>
                    <p className="text-xs text-slate-500">{FREQUENCY_LABELS[s.frequency]} · due day {s.dueDay}</p>
                  </td>
                  <td className="px-5 py-4 text-xs text-slate-600">
                    <p>{s.program?.name ?? 'All Programs'}</p>
                    <p>{s.batch?.name ?? 'All Batches'}</p>
                    <p className="text-slate-400">AY {s.academicYear}{s.dueCount ? ` · ${s.dueCount} due${s.dueCount === 1 ? '' : 's'}` : ''}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.mandatory ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.mandatory ? 'Mandatory' : 'Optional'}</span>
                  </td>
                  <td className="px-5 py-4 text-right whitespace-nowrap">
                    {s.mandatory && (
                      <button type="button" onClick={() => setDialog({ kind: 'assess', structure: s })} className="mr-1 inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <UsersRound className="size-3.5" /> Assess Dues
                      </button>
                    )}
                    <button type="button" onClick={() => setDialog({ kind: 'form', structure: s })} aria-label={`Edit ${s.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-4" /></button>
                    <button type="button" onClick={() => setDialog({ kind: 'delete', structure: s })} aria-label={`Delete ${s.name}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.error ? (
          <div className="p-6"><ErrorBanner message={list.error.message} /></div>
        ) : list.isPending ? (
          <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : rows.length === 0 ? (
          <Empty icon={Layers} title="No Fee Structures Found" text={q || category ? 'No fee structure matches these filters.' : 'Create your fee categories or click "Upload from Excel" to import them in bulk.'} />
        ) : null}
        <Pager page={current} pages={pages} total={rows.length} noun="fee structures" onPage={setPage} />
      </section>

      {dialog?.kind === 'form' && <StructureDialog schoolId={schoolId} structure={dialog.structure} academic={academic} yearStartMonth={yearStartMonth} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'assess' && <AssessDialog schoolId={schoolId} structure={dialog.structure} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete fee structure?"
          message={<><strong className="text-slate-900">{dialog.structure.name}</strong> will be deleted. A fee structure that students already have dues for is kept.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`${feesPath(schoolId)}/structures/${dialog.structure.id}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'export' && <ExportDialog title="Export Fee Structures" onClose={() => setDialog(null)} onExport={(format) => exportStructures(format, schoolName, rows)} />}
    </>
  )
}

function PaymentsTab({ schoolId, schoolName, onImport }: { schoolId: string; schoolName: string; onImport: () => void }) {
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const dues = useDues(schoolId, { q, status, page })
  const options = useFeeOptions(schoolId)
  const invalidate = useInvalidateFees(schoolId)
  const [dialog, setDialog] = useState<{ kind: 'record' } | { kind: 'due'; id: string } | { kind: 'delete'; due: Due } | { kind: 'export' } | null>(null)
  const data = dues.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  // The open due follows the list, so it shows fresh figures after a change.
  const open = dialog?.kind === 'due' ? data?.items.find((d) => d.id === dialog.id) : undefined
  const filterLabel = useMemo(() => [status ? STATUS_LABELS[status as FeeStatus] : 'All statuses', q && `matching “${q}”`].filter(Boolean).join(' '), [status, q])

  return (
    <>
      <Toolbar>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search student, receipt, roll no, transaction..." />
          <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1) }}>
            <option value="">All Statuses</option>
            {(Object.keys(STATUS_LABELS) as FeeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </FilterSelect>
        </div>
        <ActionButtons canExport={!!data?.total} onExport={() => setDialog({ kind: 'export' })} onImport={onImport} primary="Record Payment Transaction" onPrimary={() => setDialog({ kind: 'record' })} />
      </Toolbar>

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Receipt &amp; Logistics</th>
                <th className={th}>Student Records</th>
                <th className={th}>Fee Structure Link</th>
                <th className={th}>Financial Breakdown</th>
                <th className={th}>Timeline &amp; Status</th>
                <th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((d) => {
                const live = d.payments.filter((p) => !p.voidedAt)
                return (
                  <tr key={d.id} className="border-b border-slate-50 align-top text-sm last:border-0">
                    <td className="px-5 py-4">
                      {live[0] ? (
                        <>
                          <p className="flex items-center gap-1.5 font-semibold text-slate-900"><ReceiptText className="size-3.5 text-slate-400" /> {live[0].receiptNumber}</p>
                          <p className="text-xs text-slate-500">{METHOD_LABELS[live[0].method]}{live[0].transactionRef ? ` · ${live[0].transactionRef}` : ''}</p>
                          {live.length > 1 && <p className="text-[11px] text-slate-400">+{live.length - 1} more payment{live.length === 2 ? '' : 's'}</p>}
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 italic">No payment yet</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{d.student.fullName}</p>
                      <p className="text-xs text-slate-500">{[d.student.rollNumber && `Roll ${d.student.rollNumber}`, d.student.batch].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-800">{d.structure.name}</p>
                      <p className="text-xs text-slate-500">{periodLabel(d.period, d.structure.frequency)}</p>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      <p>Net <strong className="text-slate-900">{inr(d.netPaise)}</strong>{d.discountPaise ? ` (−${inr(d.discountPaise)})` : ''}{d.lateFeePaise ? ` (+${inr(d.lateFeePaise)} late)` : ''}</p>
                      <p>Paid <strong className="text-emerald-700">{inr(d.paidPaise)}</strong></p>
                      {d.outstandingPaise > 0 && <p>Due <strong className="text-red-600">{inr(d.outstandingPaise)}</strong></p>}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[d.status]}`}>{STATUS_LABELS[d.status]}</span>
                      <p className="mt-1.5">Due {formatDay(d.dueDate)}</p>
                      {d.lastPaidOn && <p>Paid {formatDay(d.lastPaidOn)}</p>}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <button type="button" onClick={() => setDialog({ kind: 'due', id: d.id })} className="mr-1 inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Eye className="size-3.5" /> {d.outstandingPaise > 0 ? 'View / Pay' : 'View'}
                      </button>
                      {d.payments.length === 0 && (
                        <button type="button" onClick={() => setDialog({ kind: 'delete', due: d })} aria-label={`Delete ${d.student.fullName}'s ${d.structure.name} due`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {dues.error ? (
          <div className="p-6"><ErrorBanner message={dues.error.message} /></div>
        ) : !data ? (
          <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
        ) : data.total === 0 ? (
          <Empty icon={FileText} title="No Payment Records Found" text={q || status ? 'No record matches these filters.' : 'Record student fee transactions, assess a mandatory fee, or click "Upload from Excel" to import payments in bulk.'} />
        ) : null}
        <Pager page={data?.page ?? 1} pages={pages} total={data?.total ?? 0} noun="payment records" onPage={setPage} />
      </section>

      {dialog?.kind === 'record' && <RecordPaymentDialog schoolId={schoolId} structures={options.data?.structures ?? []} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'due' && open && <DueDialog key={`${open.id}-${open.paidPaise}-${open.netPaise}`} schoolId={schoolId} due={open} onSaved={invalidate} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete this due?"
          message={<><strong className="text-slate-900">{dialog.due.student.fullName}</strong>’s {dialog.due.structure.name} ({periodLabel(dialog.due.period, dialog.due.structure.frequency)}) will be removed. Only a due without any payment can be deleted; otherwise set its status to Waived.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`${feesPath(schoolId)}/dues/${dialog.due.id}`, { method: 'DELETE' })
            await invalidate()
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog title="Export Fee Payments" onClose={() => setDialog(null)} onExport={async (format) => exportDues(format, schoolName, await allDues(schoolId, { q, status }), filterLabel)} />
      )}
    </>
  )
}

function ExportDialog({ title, onClose, onExport }: { title: string; onClose: () => void; onExport: (format: 'pdf' | 'csv') => void | Promise<void> }) {
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onExport(format)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export')
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={onClose} widthClass="max-w-md">
      <div className="px-6 py-5">
        <p className="mb-3 text-xs font-bold tracking-wider text-slate-700 uppercase">Export Format</p>
        <div role="radiogroup" aria-label="Export format" className="grid grid-cols-2 gap-3">
          {(
            [
              ['pdf', 'PDF', FileText],
              ['csv', 'CSV', FileSpreadsheet],
            ] as const
          ).map(([key, text, Icon]) => (
            <button key={key} type="button" role="radio" aria-checked={format === key} onClick={() => setFormat(key)} className={`flex flex-col items-center gap-2 rounded-xl border-2 py-5 text-sm font-semibold transition ${format === key ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              <Icon className="size-5" /> {text}
            </button>
          ))}
        </div>
        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      </div>
      <div className="flex justify-end gap-3 px-6 pb-6">
        <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={() => void run()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
          <Download className="size-4" /> {busy ? 'Generating…' : `Generate & Export ${format.toUpperCase()}`}
        </button>
      </div>
    </Dialog>
  )
}
