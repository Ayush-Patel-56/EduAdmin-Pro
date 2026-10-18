import type { ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { GRADE_STYLE, type Grade } from './api'

export function GradePill({ grade, className = '' }: { grade: Grade | null | undefined; className?: string }) {
  if (!grade) return <span className={`text-xs text-slate-400 ${className}`}>—</span>
  return <span className={`inline-flex min-w-8 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold ring-1 ring-inset ${GRADE_STYLE[grade]} ${className}`}>{grade}</span>
}

export function Kpi({ icon: Icon, iconClass, value, label, sub }: { icon: LucideIcon; iconClass: string; value: ReactNode; label: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className={`flex size-9 items-center justify-center rounded-lg ${iconClass}`}><Icon className="size-[18px]" /></span>
      <p className="mt-3 truncate text-2xl font-bold text-slate-900 tabular-nums">{value ?? '—'}</p>
      <p className="mt-1 text-sm font-semibold text-slate-700">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

export function Card({ title, sub, action, children, className = '' }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** Nothing to show yet, said plainly (never a 0% that looks like a score). */
export function Empty({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <Icon className="size-9 text-slate-300" strokeWidth={1.5} />
      <p className="mt-3 text-sm font-semibold text-slate-600">{title}</p>
      {sub && <p className="mt-1 max-w-md text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

export function Spinner() {
  return <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
}

/** A 0-100 bar; a missing value draws no bar. */
export function Meter({ value, tone = 'bg-indigo-500' }: { value: number | null; tone?: string }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Previous</button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Next</button>
      </div>
    </div>
  )
}
