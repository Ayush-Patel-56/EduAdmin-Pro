import { useState, type DragEvent } from 'react'
import { todayIst } from '@/lib/dates'
import { chapterTimeline, parseTargetRange, type Timeline } from '@/lib/timeline'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, Download, GripVertical, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import {
  basePath,
  STATUS_LABELS,
  sourceKey,
  useAcademicOptions,
  useSyllabus,
  type AcademicSource,
  type Structure,
  type SyllabusItem,
  type SyllabusStatus,
} from './api'
import { ALL, type AcademicFilters } from './filters'
import { ChapterDialog } from './ChapterDialog'
import { ExportSyllabusDialog } from './ExportSyllabusDialog'
import { UploadSyllabusDialog } from './UploadSyllabusDialog'

const COLUMNS: { status: SyllabusStatus; badge: string }[] = [
  { status: 'NOT_STARTED', badge: 'bg-slate-100 text-slate-600' },
  { status: 'IN_PROGRESS', badge: 'bg-indigo-50 text-indigo-600' },
  { status: 'COMPLETED', badge: 'bg-emerald-50 text-emerald-600' },
]

type SyllabusTrackerProps = {
  source: AcademicSource
  structure: Structure | undefined
  filters: AcademicFilters
  /** Shown as the (fixed) School in the chapter and upload forms. */
  schoolName: string
  /** Where "create a batch" points when there are none (admins only). */
  manageBatchesTo?: string
  /** The month (1-12) the school's academic year starts, to place target dates in a year. */
  academicYearStartMonth?: number
}

type Modal =
  | { kind: 'add' }
  | { kind: 'edit'; item: SyllabusItem }
  | { kind: 'delete'; item: SyllabusItem }
  | { kind: 'upload' }
  | { kind: 'export' }
  | null

/**
 * Kanban of a batch's chapters for one subject. Admin and faculty use this same
 * component against the same rows, so a status change on either side shows up
 * on the other (the list refreshes every 15 seconds and after every change).
 */
export function SyllabusTracker({ source, structure, filters, schoolName, manageBatchesTo, academicYearStartMonth = 4 }: SyllabusTrackerProps) {
  const today = todayIst()
  const queryClient = useQueryClient()
  const { data: options } = useAcademicOptions()
  const subjects = options?.subjects ?? []
  const [subject, setSubject] = useState<string | null>(null)
  const activeSubject = subject ?? subjects[0] ?? 'Physics'
  const [modal, setModal] = useState<Modal>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<SyllabusStatus | null>(null)

  const batches = filters.batchOptions
  const batchId = filters.batchId !== ALL ? filters.batchId : (batches[0]?.id ?? null)
  const { data: items, error, isPending } = useSyllabus(source, batchId, activeSubject)
  const listKey = [sourceKey(source), 'syllabus']

  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey })

  async function move(item: SyllabusItem, status: SyllabusStatus) {
    if (item.status === status) return
    setMoveError(null)
    const key = [sourceKey(source), 'syllabus', item.batchId, activeSubject]
    // Move the card right away; roll back if the server refuses.
    const previous = queryClient.getQueryData<SyllabusItem[]>(key)
    queryClient.setQueryData<SyllabusItem[]>(key, (old) => old?.map((i) => (i.id === item.id ? { ...i, status } : i)))
    try {
      await api(`${basePath(source)}/syllabus/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
    } catch (err) {
      queryClient.setQueryData(key, previous)
      setMoveError(err instanceof Error ? err.message : 'Could not move the chapter')
    }
    void refresh()
  }

  function onDrop(e: DragEvent, status: SyllabusStatus) {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/plain')
    const item = items?.find((i) => i.id === id)
    if (item) void move(item, status)
  }

  const noBatches = structure && structure.batches.length === 0

  return (
    <div>
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-end">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,180px)]">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Select batch</p>
            <Select
              aria-label="Select batch"
              value={batchId}
              options={batches.map((b) => ({ value: b.id, label: b.name }))}
              onChange={filters.setBatchId}
              placeholder={noBatches ? 'No batches yet' : 'Select…'}
              disabled={batches.length === 0}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Select subject</p>
            <Select
              aria-label="Select subject"
              value={activeSubject}
              options={subjects.map((s) => ({ value: s, label: s }))}
              onChange={setSubject}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setModal({ kind: 'export' })}
            disabled={batches.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="size-4" /> Export Data
          </button>
          <button
            type="button"
            onClick={() => setModal({ kind: 'upload' })}
            disabled={batches.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-hover disabled:opacity-50"
          >
            <Upload className="size-4" /> Upload Syllabus
          </button>
          <button
            type="button"
            onClick={() => setModal({ kind: 'add' })}
            disabled={batches.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" /> Add Chapter
          </button>
        </div>
      </div>

      {noBatches && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {source.kind === 'admin' ? (
            <>
              No batches yet. Syllabus is tracked per batch, so{' '}
              {manageBatchesTo ? (
                <Link to={manageBatchesTo} className="font-semibold underline">
                  create a batch first
                </Link>
              ) : (
                'create a batch first'
              )}
              .
            </>
          ) : (
            'No batches are assigned to you yet. Ask your admin to add you to a batch.'
          )}
        </p>
      )}
      {!noBatches && structure && batches.length === 0 && (
        <p className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          No batches in the program selected in the sidebar. Pick another program or “All Programs”.
        </p>
      )}
      <div className="mt-4 space-y-3">
        <ErrorBanner message={error?.message ?? moveError} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {COLUMNS.map(({ status, badge }) => {
          const cards = items?.filter((i) => i.status === status) ?? []
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(status)
              }}
              onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
              onDrop={(e) => onDrop(e, status)}
              className={`flex min-h-[420px] flex-col rounded-2xl border bg-white p-4 transition ${
                dragOver === status ? 'border-brand-400 ring-2 ring-brand-50' : 'border-slate-200'
              }`}
            >
              <header className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-xs font-bold tracking-wider text-slate-800 uppercase">{STATUS_LABELS[status]}</h3>
                <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${badge}`}>
                  {cards.length}
                </span>
              </header>
              <div className="mt-3 flex flex-1 flex-col gap-3">
                {batchId && isPending ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-slate-300" aria-label="Loading" />
                  </div>
                ) : cards.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-xs text-slate-400">
                    No chapters in this stage
                  </div>
                ) : (
                  cards.map((item) => (
                    <ChapterCard
                      timeline={chapterTimeline(item.status, parseTargetRange(item.targetDates, academicYearStartMonth, today), today)}
                      key={item.id}
                      item={item}
                      onMove={(s) => move(item, s)}
                      onEdit={() => setModal({ kind: 'edit', item })}
                      onDelete={() => setModal({ kind: 'delete', item })}
                    />
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>

      {(modal?.kind === 'add' || modal?.kind === 'edit') && (
        <ChapterDialog
          source={source}
          structure={structure}
          schoolName={schoolName}
          item={modal.kind === 'edit' ? modal.item : undefined}
          defaults={{ batchId, subject: activeSubject }}
          onSaved={refresh}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete chapter?"
          message={
            <>
              <strong className="text-slate-900">{modal.item.title}</strong> will be removed from this batch’s syllabus for
              both admin and faculty.
            </>
          }
          confirmLabel="Delete Chapter"
          onConfirm={async () => {
            await api(`${basePath(source)}/syllabus/${modal.item.id}`, { method: 'DELETE' })
            await refresh()
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'upload' && (
        <UploadSyllabusDialog
          source={source}
          structure={structure}
          schoolName={schoolName}
          defaults={{ batchId: filters.batchId !== ALL ? filters.batchId : null, programId: filters.programId !== ALL ? filters.programId : null, subject: activeSubject }}
          onImported={refresh}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'export' && (
        <ExportSyllabusDialog
          source={source}
          structure={structure}
          schoolName={schoolName}
          defaults={{ batchId, subject: activeSubject }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

type ChapterCardProps = {
  /** Red / amber / green for the target dates; null when they can't be read. */
  timeline: Timeline | null
  item: SyllabusItem
  onMove: (status: SyllabusStatus) => void
  onEdit: () => void
  onDelete: () => void
}

const TONE: Record<Timeline['tone'], { bar: string; pill: string }> = {
  green: { bar: 'border-l-emerald-500', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  amber: { bar: 'border-l-amber-500', pill: 'bg-amber-50 text-amber-800 ring-amber-200' },
  red: { bar: 'border-l-red-500', pill: 'bg-red-50 text-red-700 ring-red-200' },
}

function ChapterCard({ item, timeline, onMove, onEdit, onDelete }: ChapterCardProps) {
  const tone = timeline ? TONE[timeline.tone] : null
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`group cursor-grab rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:shadow-md active:cursor-grabbing ${tone ? `border-l-4 ${tone.bar}` : ''}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 size-4 shrink-0 text-slate-300" aria-hidden />
        <h4 className="flex-1 text-sm font-semibold text-slate-900">{item.title}</h4>
        <div className="flex gap-1 opacity-60 group-hover:opacity-100">
          <button type="button" onClick={onEdit} aria-label={`Edit ${item.title}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Pencil className="size-3.5" />
          </button>
          <button type="button" onClick={onDelete} aria-label={`Delete ${item.title}`} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {(item.estimatedHours !== null || item.targetDates) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-[11px] text-slate-500">
          {item.estimatedHours !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {item.estimatedHours} hrs est.
            </span>
          )}
          {item.targetDates && <span>{item.targetDates}</span>}
        </p>
      )}
      {timeline && item.status !== 'COMPLETED' && (
        <p className="mt-2 pl-6">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tone!.pill}`}>{timeline.label}</span>
        </p>
      )}
      {item.remarks && <p className="mt-2 pl-6 text-xs text-slate-600 italic">{item.remarks}</p>}
      <div className="mt-3 pl-6">
        <label className="sr-only" htmlFor={`status-${item.id}`}>
          Status of {item.title}
        </label>
        <select
          id={`status-${item.id}`}
          value={item.status}
          onChange={(e) => onMove(e.target.value as SyllabusStatus)}
          className="h-7 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 focus:outline-none"
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {STATUS_LABELS[c.status]}
            </option>
          ))}
        </select>
      </div>
    </article>
  )
}
