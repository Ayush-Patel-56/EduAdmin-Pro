import type { ReactNode } from 'react'
import { Filter, Pencil, Search, Star, Trash2 } from 'lucide-react'

export function Toolbar({ search, onSearch, placeholder, children }: { search: string; onSearch: (v: string) => void; placeholder: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label="Search"
          maxLength={100}
          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

export function DepartmentFilter({ value, onChange, departments }: { value: string; onChange: (v: string) => void; departments: string[] }) {
  return (
    <label className="relative inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white pl-9 text-sm font-bold text-slate-800">
      <Filter className="pointer-events-none absolute left-3 size-4 text-slate-500" />
      <span className="sr-only">Department</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-full rounded-lg bg-transparent pr-3 focus:outline-none">
        <option value="">All Departments</option>
        {departments.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </label>
  )
}

export function RowActions({ label, onEdit, onDelete, children }: { label: string; onEdit: () => void; onDelete: () => void; children?: ReactNode }) {
  return (
    <div className="flex justify-end gap-1">
      {children}
      <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} title="Edit" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        <Pencil className="size-4" />
      </button>
      <button type="button" onClick={onDelete} aria-label={`Delete ${label}`} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

/** 1-5 rating as stars, with the number for screen readers. */
export function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-300">—</span>
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`} title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-3.5 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} aria-hidden />
      ))}
    </span>
  )
}

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${className}`}>{children}</span>
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-sm text-slate-600">{children}</td>
    </tr>
  )
}
