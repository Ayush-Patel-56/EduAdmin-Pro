import type { UseQueryResult } from '@tanstack/react-query'
import { Filter, Loader2, Sheet } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { MASTER_FIELDS, type CurriculumOptions, type MasterFilters, type MasterRow } from './api'

type MasterSheetTabProps = {
  options: CurriculumOptions
  filters: MasterFilters
  onFiltersChange: (filters: MasterFilters) => void
  query: UseQueryResult<MasterRow[]>
}

const filterSelect =
  'h-9 min-w-28 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none'

/** Every chapter and concept as one flat, filterable table (one row per concept). */
export function MasterSheetTab({ options, filters, onFiltersChange, query }: MasterSheetTabProps) {
  const { data: rows, error, isPending, isFetching } = query
  const set = (key: keyof MasterFilters, value: string) => onFiltersChange({ ...filters, [key]: value })

  return (
    <>
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
        <p className="flex items-center gap-1.5 pb-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
          <Filter className="size-3.5" /> Filters
        </p>
        <div className="flex flex-1 flex-wrap gap-3">
          <FilterSelect label="Board" value={filters.board} onChange={(v) => set('board', v)} all="All Boards" items={options.boards.map((b) => [b, b])} />
          <FilterSelect label="Class" value={filters.classLevel} onChange={(v) => set('classLevel', v)} all="All Classes" items={options.classes.map((c) => [c, c])} />
          <FilterSelect label="Program" value={filters.programId} onChange={(v) => set('programId', v)} all="All Programs" items={options.programs.map((p) => [p.id, p.name])} />
          <FilterSelect label="Subject" value={filters.subject} onChange={(v) => set('subject', v)} all="All Subjects" items={options.subjects.map((s) => [s, s])} />
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 sm:self-end">
          {isFetching && <Loader2 className="size-3 animate-spin text-slate-400" aria-hidden />}
          {rows?.length ?? 0} row{rows?.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-4">
        <ErrorBanner message={error?.message} />
        {isPending ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" />
          </div>
        ) : rows && rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center">
            <Sheet className="size-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-500">No curriculum data found</p>
            <p className="mt-1 text-xs text-slate-400">
              {Object.values(filters).some(Boolean)
                ? 'Nothing matches these filters. Try widening them.'
                : 'Add chapters & concepts via the editor tab or import a CSV, then return here.'}
            </p>
          </div>
        ) : (
          rows && (
            <div className="max-h-[calc(100dvh-320px)] min-h-48 overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Subject</th>
                    {MASTER_FIELDS.map((f) => <th key={f} className="px-4 py-3">{f}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={r.conceptId ?? `chapter-${r.chapterId}`} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{r.subject}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{r.chapterName}</td>
                      <Cell value={r.chapterCode} mono />
                      <Cell value={r.board} />
                      <Cell value={r.classLevel} />
                      <Cell value={r.program} />
                      <Cell value={r.expectedHours} />
                      <Cell value={r.conceptName} />
                      <Cell value={r.conceptCode} mono />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </>
  )
}

function Cell({ value, mono }: { value: string | number | null; mono?: boolean }) {
  return (
    <td className={`px-4 py-2.5 text-slate-700 ${mono ? 'font-mono text-xs whitespace-nowrap' : ''}`}>
      {value ?? <span className="text-slate-300">—</span>}
    </td>
  )
}

type FilterSelectProps = { label: string; value: string; onChange: (value: string) => void; all: string; items: [string, string][] }

function FilterSelect({ label, value, onChange, all, items }: FilterSelectProps) {
  const id = `master-${label.toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={filterSelect}>
        <option value="">{all}</option>
        {items.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  )
}
