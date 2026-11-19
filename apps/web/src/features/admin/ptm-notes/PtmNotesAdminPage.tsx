import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { Select } from '@/components/ui/Select'
import { ALL } from '@/features/academic/filters'
import { useAdminPtmNotes, useAdminPtmTeachers } from '@/features/ptm-notes/api'
import { NoteCard } from '@/features/ptm-notes/NoteCard'
import { useAdminContext } from '../adminContext'

/**
 * PTM Notes for admins: every parent meeting the school's teachers logged in
 * the Faculty Portal, for the sidebar's program and batch. Read only: the
 * notes are the teacher's record, so they edit their own; admins read and print.
 */
export function PtmNotesAdminPage() {
  const { schoolId, structure, filters } = useAdminContext()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [facultyId, setFacultyId] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const notes = useAdminPtmNotes(schoolId, { programId: filters.programId, batchId: filters.batchId, facultyId, q })
  const teachers = useAdminPtmTeachers(schoolId)
  const teacherOptions = useMemo(
    () => [{ value: '', label: 'All teachers' }, ...(teachers.data?.teachers ?? []).map((t) => ({ value: t.id, label: t.name }))],
    [teachers.data],
  )
  const scope =
    filters.batchId !== ALL
      ? structure?.batches.find((b) => b.id === filters.batchId)?.name
      : filters.programId !== ALL
        ? structure?.programs.find((p) => p.id === filters.programId)?.name
        : null
  const data = notes.data
  const narrowed = !!q || !!facultyId || filters.programId !== ALL || filters.batchId !== ALL

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">PTM Notes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Parent meeting notes and action items logged by teachers{scope ? ` · ${scope}` : ''}. Teachers edit their own notes; here you can read and print them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void notes.refetch()}
          disabled={notes.isFetching}
          className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${notes.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student, parent, teacher or notes..."
            aria-label="Search PTM notes"
            maxLength={100}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
          />
        </div>
        <div className="sm:w-56">
          <Select id="ptm-teacher" value={facultyId} options={teacherOptions} onChange={setFacultyId} placeholder="All teachers" />
        </div>
        <span className="shrink-0 px-1 text-xs font-semibold text-slate-500">Total: {data?.total ?? '–'}</span>
      </div>

      {notes.error && <div className="mt-4"><ErrorBanner message={notes.error.message} /></div>}
      {!data && !notes.error ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-slate-300" aria-label="Loading" /></div>
      ) : data && data.items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500 shadow-sm">
          {narrowed ? 'No PTM notes match these filters.' : 'No PTM notes yet. They show here as teachers log parent meetings in the Faculty Portal.'}
        </p>
      ) : (
        data && (
          <>
            <ul className="mt-6 space-y-4">{data.items.map((n) => <NoteCard key={n.id} note={n} showTeacher />)}</ul>
            {data.total > data.items.length && (
              <p className="mt-4 text-center text-xs text-slate-400">Showing the latest {data.items.length} of {data.total}. Search or filter to find older notes.</p>
            )}
          </>
        )
      )}
    </>
  )
}
