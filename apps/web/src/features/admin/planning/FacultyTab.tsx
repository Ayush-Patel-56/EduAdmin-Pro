import { useRef, useState, type DragEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Download, FileSpreadsheet, Link2, Loader2, Trash2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadFile, MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords, toCsv } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary } from '@/components/ui/formStyles'
import { FACULTY_STATUS_LABELS, useInvalidateAcademic, type Faculty, type FacultyStatus, type ImportPreview } from '@/features/academic/api'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { useAdminContext } from '../adminContext'

const STATUS_STYLE: Record<FacultyStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ON_LEAVE: 'border-amber-200 bg-amber-50 text-amber-700',
  INACTIVE: 'border-slate-200 bg-slate-50 text-slate-500',
}

export function FacultyTab() {
  const { schoolId } = useAdminContext()
  const invalidate = useInvalidateAcademic()
  const { data: faculty, error, isPending } = useQuery({
    queryKey: [schoolId, 'faculty'],
    queryFn: () => api<Faculty[]>(`/schools/${schoolId}/faculty`),
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<'import' | 'delete' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const all = faculty ?? []
  const allSelected = all.length > 0 && all.every((f) => selected.has(f.id))
  const selectedRows = all.filter((f) => selected.has(f.id))
  const deletable = selectedRows.filter((f) => !f.linked)

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {all.length} faculty member{all.length === 1 ? '' : 's'} across all batches
        </p>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setModal('delete')}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <Trash2 className="size-4" /> Delete ({selected.size})
            </button>
          )}
          <button type="button" onClick={() => setModal('import')} className={btnPrimary}>
            <Upload className="size-4" /> Import CSV
          </button>
        </div>
      </div>

      {notice && <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{notice}</p>}
      <div className="mt-6">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {faculty && (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                <tr>
                  <th className="w-12 px-5 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all faculty"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(all.map((f) => f.id)))}
                      className="size-4 accent-indigo-600"
                    />
                  </th>
                  <th className="px-3 py-3">Avatar</th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Phone number</th>
                  <th className="px-3 py-3">Subject / Specialization</th>
                  <th className="px-3 py-3">Batches</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {all.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                      No faculty yet. Teachers appear here when they join with the school’s invite code, or import them from a sheet.
                    </td>
                  </tr>
                )}
                {all.map((f) => (
                  <tr key={f.id} className={selected.has(f.id) ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}>
                    <td className="px-5 py-3">
                      <input type="checkbox" aria-label={`Select ${f.name}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} className="size-4 accent-indigo-600" />
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
                        {f.name.trim().charAt(0).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-900">{f.name}</p>
                      <p className="flex items-center gap-1 text-[11px] text-slate-500">
                        {f.linked && <Link2 className="size-3 text-emerald-600" aria-label="Linked to a login" />}
                        {f.email ?? (f.employeeId ? `ID ${f.employeeId}` : '')}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{f.phone ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {f.subjects.join(', ') || 'General'}
                      {f.specialization && <span className="block text-[11px] text-slate-500">{f.specialization}</span>}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{f.batches.map((b) => b.name).join(', ') || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATUS_STYLE[f.status]}`}>
                        {FACULTY_STATUS_LABELS[f.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === 'import' && (
        <ImportFacultyDialog
          schoolId={schoolId}
          onImported={() => invalidate({ kind: 'admin', schoolId })}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'delete' && (
        <ConfirmDialog
          title={`Delete ${selected.size} faculty profile${selected.size === 1 ? '' : 's'}?`}
          message={
            <>
              {deletable.length > 0 ? (
                <p>{deletable.length} imported profile{deletable.length === 1 ? '' : 's'} and their batch assignments will be deleted.</p>
              ) : (
                <p>None of the selected profiles can be deleted here.</p>
              )}
              {selectedRows.length > deletable.length && (
                <p className="mt-2 text-xs text-slate-500">
                  {selectedRows.length - deletable.length} selected teacher{selectedRows.length - deletable.length === 1 ? ' has' : 's have'} a
                  login in this school and will be kept. Set them Inactive instead.
                </p>
              )}
            </>
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            const result = await api<{ deleted: number; keptLinked: string[] }>(`/schools/${schoolId}/faculty`, {
              method: 'DELETE',
              body: JSON.stringify({ ids: [...selected] }),
            })
            setSelected(new Set())
            setNotice(
              `Deleted ${result.deleted} profile${result.deleted === 1 ? '' : 's'}.` +
                (result.keptLinked.length ? ` Kept ${result.keptLinked.join(', ')} (linked to a login).` : ''),
            )
            await invalidate({ kind: 'admin', schoolId })
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}

const FACULTY_COLUMNS = {
  name: ['Name', 'Full Name'],
  employeeId: ['Employee ID', 'Emp ID'],
  email: ['Email'],
  phone: ['Phone', 'Mobile'],
  altPhone: ['Alt Phone', 'Alternate Phone'],
  dateOfBirth: ['Date of Birth', 'DOB'],
  gender: ['Gender'],
  address: ['Address Line 1', 'Address'],
  city: ['City'],
  state: ['State'],
  pincode: ['Pincode', 'PIN'],
  subjects: ['Subject', 'Subjects'],
  specialization: ['Specialization', 'Specialisation'],
  qualification: ['Qualification'],
  experienceYears: ['Experience (Years)', 'Experience'],
  joiningDate: ['Joining Date', 'Date of Joining'],
  status: ['Status'],
  batches: ['Batches', 'Batch'],
  bio: ['Bio'],
  profileImageUrl: ['Profile Image URL', 'Photo URL'],
}

const SAMPLE = [
  ['Name', 'Employee ID', 'Email', 'Phone', 'Alt Phone', 'Date of Birth (YYYY-MM-DD)', 'Gender', 'Address Line 1', 'City', 'State', 'Pincode', 'Subject', 'Specialization', 'Qualification', 'Experience (Years)', 'Joining Date (YYYY-MM-DD)', 'Status', 'Batches', 'Bio', 'Profile Image URL'],
  ['Anita Rao', 'EMP-201', 'anita.rao@example.com', '9876500011', '9876500012', '1985-03-14', 'Female', '22 Park Street', 'Ahmedabad', 'Gujarat', '380001', 'Physics', 'Mechanics', 'M.Sc. Physics', '8', '2020-06-01', 'ACTIVE', '', 'Specializes in mechanics and problem solving.', ''],
  ['Vikram Singh', '', '', '', '', '', '', '', '', '', '', 'Chemistry', 'Organic Chemistry', '', '', '', 'ACTIVE', '', '', ''],
]

function ImportFacultyDialog({ schoolId, onImported, onClose }: { schoolId: string; onImported: () => Promise<unknown>; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const send = (rows: Record<string, string>[], dryRun: boolean) =>
    api<ImportPreview>(`/schools/${schoolId}/faculty/import`, { method: 'POST', body: JSON.stringify({ rows, dryRun }) })

  async function choose(next: File | undefined) {
    if (!next) return
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { records: parsed, missing } = rowsToRecords(await readSpreadsheet(next), FACULTY_COLUMNS)
      if (missing.includes('name')) throw new Error('The file needs a "Name" column. Download the sample to see the format.')
      if (parsed.length === 0) throw new Error('The file has no rows under the header')
      if (parsed.length > MAX_IMPORT_ROWS) throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`)
      const clean = parsed as Record<string, string>[]
      setRecords(clean)
      setPreview(await send(clean, true))
    } catch (err) {
      setRecords(null)
      setError(err instanceof Error ? err.message : 'Could not read the file')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!records) return
    setBusy(true)
    try {
      setPreview(await send(records, false))
      await onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void choose(e.dataTransfer.files[0])
  }

  const importable = preview && !preview.applied && preview.created + preview.updated > 0

  return (
    <Dialog title="Import Faculty from CSV / Excel" onClose={onClose} widthClass="max-w-2xl">
      <div className="space-y-4 px-6 py-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
            dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-indigo-600">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-800">{file ? file.name : 'Drag & drop your Excel/CSV here'}</p>
          <p className="mt-1 text-xs text-slate-500">or click to browse from your device (.csv, .xlsx)</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <FileSpreadsheet className="size-3.5 text-emerald-600" /> Format template
          </p>
          <button
            type="button"
            onClick={() => downloadFile('faculty-sample.csv', toCsv(SAMPLE))}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 hover:text-brand-600"
          >
            <Download className="size-3.5" /> Download Sample CSV
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          A row whose email (or employee ID) matches an existing profile updates it; blank cells keep the current value.
          Batch names must match batches in this school.
        </p>
        <ErrorBanner message={error} />
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800">
            <Check className="size-4" /> Imported.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>{preview?.applied ? 'Done' : 'Cancel'}</button>
        {!preview?.applied && (
          <button type="button" onClick={apply} disabled={!importable || busy} className={btnPrimary}>
            {importable ? `Import ${preview.created + preview.updated} Faculty` : 'Import'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
