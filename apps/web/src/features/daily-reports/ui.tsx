import type { ReactNode } from 'react'
import { CircleCheck, Clock, type LucideIcon } from 'lucide-react'

/** Full-width tab bar right under the top bar (it bleeds through the page padding of the portal shell). */
export function ReportTabBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 -mt-6 mb-7 flex gap-7 overflow-x-auto border-b border-slate-200 bg-white px-4 sm:-mx-6 sm:px-6 lg:-mt-8">
      {children}
    </div>
  )
}

/** The tab bar under the top bar on both Daily Reports pages. */
export function ReportTab({ active, onClick, icon: Icon, label, accent = 'emerald' }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; accent?: 'emerald' | 'ink' }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 py-4 text-sm font-semibold whitespace-nowrap transition ${active ? `border-indigo-500 ${accent === 'emerald' ? 'text-emerald-600' : 'text-slate-900'}` : 'border-transparent text-slate-600 hover:text-slate-900'}`}
    >
      <Icon className="size-4" /> {label}
    </button>
  )
}

/** On Time (submitted on the day taught) or Late, as the server decided. */
export function StatusPill({ late }: { late: boolean }) {
  return late ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-700 uppercase"><Clock className="size-3" /> Late</span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 uppercase"><CircleCheck className="size-3" /> On Time</span>
  )
}
