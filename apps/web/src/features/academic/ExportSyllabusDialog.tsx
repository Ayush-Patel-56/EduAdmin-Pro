import { useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnSecondary, inputClass, labelClass } from '@/components/ui/formStyles'
import { basePath, STATUS_LABELS, useAcademicOptions, type AcademicSource, type Structure, type SyllabusItem } from './api'
import { printReport } from './syllabusReport'

type ExportSyllabusDialogProps = {
  source: AcademicSource
  structure: Structure | undefined
  schoolName: string
  defaults: { batchId: string | null; subject: string }
  onClose: () => void
}

const ALL_SUBJECTS = ''

export function ExportSyllabusDialog({ source, structure, schoolName, defaults, onClose }: ExportSyllabusDialogProps) {
  const { data: options } = useAcademicOptions()
  const batches = structure?.batches ?? []
  const [batchId, setBatchId] = useState(defaults.batchId ?? batches[0]?.id ?? '')
  const [subject, setSubject] = useState(ALL_SUBJECTS)
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function generate() {
    const batch = batches.find((b) => b.id === batchId)
    if (!batch) return setError('Select a batch')
    setBusy(true)
    setError(null)
    try {
      const query = `batchId=${batch.id}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`
      const items = await api<SyllabusItem[]>(`${basePath(source)}/syllabus?${query}`)
      const program = structure?.programs.find((p) => p.id === batch.programId)?.name ?? ''
      const fileBase = `syllabus-${batch.name}-${subject || 'all-subjects'}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      if (format === 'csv') {
        downloadFile(
          `${fileBase}.csv`,
          toCsv([
            ['School', 'Program', 'Batch', 'Subject', 'Chapter Title', 'Estimated Hours', 'Target Dates', 'Status', 'Teacher Remarks & Notes'],
            ...items.map((i) => [
              schoolName,
              program,
              batch.name,
              i.subject,
              i.title,
              i.estimatedHours === null ? '' : `${i.estimatedHours} hrs est.`,
              i.targetDates,
              STATUS_LABELS[i.status].toUpperCase(),
              i.remarks,
            ]),
          ]),
        )
      } else {
        printReport({ schoolName, program, batch: batch.name, subject: subject || 'All Subjects', items })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
      setBusy(false)
    }
  }

  return (
    <Dialog title="Export Syllabus Data" description="Download batch-wise subject coverage in PDF or CSV format" onClose={onClose} widthClass="max-w-md">
      <div className="space-y-4 px-6 py-5">
        <div>
          <label htmlFor="export-batch" className={labelClass}>Select batch</label>
          <select id="export-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputClass()}>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="export-subject" className={labelClass}>Select subject</label>
          <select id="export-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass()}>
            <option value={ALL_SUBJECTS}>All Subjects (Batch-Wise)</option>
            {(options?.subjects ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <p className={labelClass}>Export format</p>
          <div role="radiogroup" aria-label="Export format" className="grid grid-cols-2 gap-3">
            {[
              { value: 'pdf' as const, label: 'Colorful PDF Report', icon: FileText },
              { value: 'csv' as const, label: 'CSV Spreadsheet', icon: FileSpreadsheet },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={format === value}
                onClick={() => setFormat(value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-4 text-xs font-semibold transition ${
                  format === value ? 'border-emerald-500 bg-emerald-50 text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="size-5 text-emerald-600" /> {label}
              </button>
            ))}
          </div>
          {format === 'pdf' && <p className="mt-2 text-[10px] text-slate-400">Opens your browser’s print dialog — choose “Save as PDF”.</p>}
        </div>
        <ErrorBanner message={error} />
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !batchId}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          <Download className="size-4" /> {busy ? 'Preparing…' : `Generate & Export ${format.toUpperCase()}`}
        </button>
      </div>
    </Dialog>
  )
}
