import { useEffect, useRef, useState } from 'react'
import { Search, UserRound, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useDismiss } from '@/components/ui/useDismiss'
import { rosterQuery, type StudentPage } from './api'

export type PickedStudent = { id: string; fullName: string; detail: string }

type Props = {
  /** Admins search their school's roster; teachers search the students they can see. */
  portal: { kind: 'admin'; schoolId: string } | { kind: 'teacher' }
  value: PickedStudent | null
  onChange: (student: PickedStudent | null) => void
  id?: string
  placeholder?: string
}

/** Type to search active students, then pick one. */
export function StudentPicker({ portal, value, onChange, id, placeholder = 'Search active students...' }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedStudent[] | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  const schoolId = portal.kind === 'admin' ? portal.schoolId : null

  useEffect(() => {
    const q = query.trim()
    if (!open) return
    let current = true
    const timer = setTimeout(() => {
      const params = rosterQuery({ q, status: 'ACTIVE', pageSize: 8 })
      const path = schoolId ? `/schools/${schoolId}/students${params}` : `/teacher/students${params}`
      api<StudentPage>(path)
        .then((page) => {
          if (!current) return
          setResults(
            page.items.map((s) => ({
              id: s.id,
              fullName: s.fullName,
              detail: [s.classLevel && `Class ${s.classLevel}`, s.batch?.name ?? 'Unassigned', s.rollNumber && `Roll ${s.rollNumber}`]
                .filter(Boolean)
                .join(' · '),
            })),
          )
        })
        .catch(() => current && setResults([]))
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query, open, schoolId])

  if (value) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
        <UserRound className="size-4 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
          <span className="font-semibold">{value.fullName}</span>
          {value.detail && <span className="text-xs text-slate-500"> · {value.detail}</span>}
        </span>
        <button type="button" aria-label="Change student" onClick={() => onChange(null)} className="rounded p-1 text-slate-400 hover:text-slate-700">
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:outline-none"
      />
      {open && results && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-500">No matching active students.</li>
          ) : (
            results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onChange(s)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="block text-sm font-semibold text-slate-900">{s.fullName}</span>
                  <span className="block text-[11px] text-slate-500">{s.detail}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
