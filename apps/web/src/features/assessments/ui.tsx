import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Loader2, type LucideIcon } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { DIFFICULTY_LABELS, PHASE_LABELS, TEST_TYPE_LABELS, TYPE_LABELS, type Difficulty, type QuestionType, type TestPhase, type TestType } from './api'

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  EASY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  HARD: 'border-rose-200 bg-rose-50 text-rose-700',
}

export function DifficultyBadge({ value }: { value: Difficulty }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${DIFFICULTY_STYLE[value]}`}>{DIFFICULTY_LABELS[value]}</span>
}

export function TypeBadge({ value }: { value: QuestionType }) {
  return <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{TYPE_LABELS[value]}</span>
}

export function TestTypeBadge({ value }: { value: TestType }) {
  return <span className="inline-flex rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{TEST_TYPE_LABELS[value]}</span>
}

const PHASE_STYLE: Record<TestPhase, string> = {
  SCHEDULED: 'border-blue-200 bg-blue-50 text-blue-700',
  ONGOING: 'border-amber-200 bg-amber-50 text-amber-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-500',
}

export function PhaseBadge({ value }: { value: TestPhase }) {
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${PHASE_STYLE[value]}`}>{PHASE_LABELS[value]}</span>
}

/** A filter dropdown whose first option ("All Subjects") clears it. */
export function FilterSelect({ label, all, value, options, onChange, icon }: { label: string; all: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; icon?: LucideIcon }) {
  return (
    <div className="w-full sm:w-44">
      <Select aria-label={label} size="sm" icon={icon} value={value} options={[{ value: '', label: all }, ...options]} onChange={onChange} />
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage, noun }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun: string }) {
  if (!total) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:px-5">
      <span>
        Showing {from}–{to} of {total} {noun}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 font-semibold text-slate-700 tabular-nums">
          {page} / {pages}
        </span>
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-14">
      <Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-6 py-14 text-center text-sm text-slate-400">{children}</div>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
}

export function Kpi({ label, value, hint, icon: Icon, tone }: { label: string; value: ReactNode; hint?: string; icon: LucideIcon; tone: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</p>
        <p className="mt-2 text-3xl font-black text-slate-900 tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
      </div>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="size-5" />
      </span>
    </div>
  )
}

/** Underlined tabs, as on the other management pages. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { key: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mb-px flex gap-6 overflow-x-auto border-b border-slate-200">
      {tabs.map(({ key, label: text, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold whitespace-nowrap transition ${value === key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          {Icon && <Icon className="size-4" />} {text}
        </button>
      ))}
    </div>
  )
}

export const thClass = 'px-4 py-3 text-left text-[11px] font-bold tracking-wider whitespace-nowrap text-slate-500 uppercase'
export const tdClass = 'px-4 py-3 align-top text-sm text-slate-700'
export const iconBtn = 'rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40'
