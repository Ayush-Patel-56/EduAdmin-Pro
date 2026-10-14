import { useRef, useState, type DragEvent } from 'react'
import { Check, Download, FileSpreadsheet, FileText, Info, Layers, Loader2, Table2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadFile, MAX_IMPORT_ROWS, readSpreadsheet, rowsToRecords, toCsv } from '@/lib/spreadsheet'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { ImportPreview } from '@/features/academic/api'
import { ImportPreviewTable } from '@/features/academic/ImportPreviewTable'
import { feesPath } from '@/features/fees/api'

export type FeeSchema = 'structures' | 'payments'

type Column = { header: string; type: string; required: boolean; rule: string; example?: string }

const SCHEMAS: Record<FeeSchema, { title: string; columns: Record<string, string[]>; spec: Column[]; sample: string[][]; endpoint: string; requiredField: string; requiredHeader: string }> = {
  structures: {
    title: 'Fee Structures',
    endpoint: 'structures/import',
    requiredField: 'name',
    requiredHeader: 'Fee Name',
    columns: {
      name: ['Fee Name', 'Name', 'Fee Structure Name'],
      category: ['Fee Category', 'Category'],
      amount: ['Amount (INR)', 'Amount'],
      frequency: ['Frequency'],
      dueDay: ['Due Day'],
      mandatory: ['Mandatory'],
      program: ['Program'],
      batch: ['Batch'],
      academicYear: ['Academic Year'],
      description: ['Description'],
    },
    spec: [
      { header: 'Fee Name', type: 'Text', required: true, rule: 'Full name of the fee; one per school. A name that exists updates that fee.', example: 'Tuition Fee - Core JEE' },
      { header: 'Fee Category', type: 'Text', required: true, rule: 'Registration Fee, Monthly Tuition, Exam Fee, Material Fee or Other.' },
      { header: 'Amount (INR)', type: 'Number', required: true, rule: 'Rupees, up to two decimals; commas and ₹ are ignored.', example: '12500' },
      { header: 'Frequency', type: 'Text', required: true, rule: 'One-time, Monthly, Quarterly or Yearly.' },
      { header: 'Due Day', type: 'Number', required: false, rule: 'Day of the month (1-31); a shorter month uses its last day. Defaults to 5.' },
      { header: 'Mandatory', type: 'Yes/No', required: false, rule: 'Yes (default) assesses it for every student in scope; No records it per student.' },
      { header: 'Program', type: 'Text', required: false, rule: 'A program of this school, or blank / All Programs.' },
      { header: 'Batch', type: 'Text', required: false, rule: 'A batch of this school, or blank / All Batches.' },
      { header: 'Academic Year', type: 'Text', required: false, rule: 'Like 2026-27. Defaults to the current academic year.' },
      { header: 'Description', type: 'Text', required: false, rule: 'Any notes about the fee.' },
    ],
    sample: [
      ['Fee Name', 'Fee Category', 'Amount (INR)', 'Frequency', 'Due Day', 'Mandatory', 'Program', 'Batch', 'Academic Year', 'Description'],
      ['Tuition Fee - Core JEE', 'Monthly Tuition', '12500', 'Monthly', '5', 'Yes', 'JEE', '', '2026-27', 'Standard monthly tuition'],
      ['Term 1 Exam Fee', 'Exam Fee', '2500', 'Quarterly', '15', 'Yes', 'All Programs', 'All Batches', '2026-27', 'Evaluation and invigilation fee'],
      ['Study Modules', 'Material Fee', '15000', 'Yearly', '10', 'No', '', '', '2026-27', 'Printed modules and LMS access'],
    ],
  },
  payments: {
    title: 'Fee Payments',
    endpoint: 'dues/import',
    requiredField: 'rollNumber',
    requiredHeader: 'Student Roll No',
    columns: {
      rollNumber: ['Student Roll No', 'Roll No', 'Roll Number'],
      studentName: ['Student Name', 'Name'],
      structureName: ['Fee Structure Name', 'Fee Structure', 'Fee Name'],
      amountDue: ['Amount Due'],
      amountPaid: ['Amount Paid'],
      discount: ['Discount'],
      lateFee: ['Late Fee'],
      method: ['Payment Method', 'Method'],
      receiptNumber: ['Receipt No', 'Receipt Number'],
      transactionRef: ['Transaction ID', 'Transaction Ref', 'Reference'],
      dueDate: ['Due Date'],
      paidOn: ['Paid Date', 'Payment Date'],
    },
    spec: [
      { header: 'Student Roll No', type: 'Text', required: true, rule: "The student's roll number (or admission number).", example: 'RN-101' },
      { header: 'Student Name', type: 'Text', required: true, rule: 'Must be the student with that roll number.', example: 'Aarav Sharma' },
      { header: 'Fee Structure Name', type: 'Text', required: true, rule: 'Exactly the name of one of this school’s fee structures.', example: 'Tuition Fee - Core JEE' },
      { header: 'Amount Due / Amount Paid', type: 'Number', required: true, rule: 'Rupees. Amount Due defaults to the fee’s amount; a row adds its payment to the student’s due for that period.', example: '12500' },
      { header: 'Discount / Late Fee', type: 'Number', required: false, rule: 'Rupees; default 0. Net payable = due − discount + late fee.' },
      { header: 'Payment Method', type: 'Text', required: false, rule: 'Needed when something is paid: UPI, Cash, Card, Net Banking, Cheque or DD.' },
      { header: 'Receipt No', type: 'Text', required: false, rule: 'Unique in the school; blank gives the next automatic number.' },
      { header: 'Transaction ID', type: 'Text', required: false, rule: 'Can’t repeat a reference already recorded.' },
      { header: 'Due Date / Paid Date', type: 'Date', required: false, rule: 'YYYY-MM-DD or DD-MM-YYYY. Paid date defaults to today and can’t be in the future.' },
    ],
    sample: [
      ['Student Roll No', 'Student Name', 'Fee Structure Name', 'Amount Due', 'Amount Paid', 'Discount', 'Late Fee', 'Payment Method', 'Receipt No', 'Transaction ID', 'Due Date', 'Paid Date'],
      ['RN-101', 'Aarav Sharma', 'Tuition Fee - Core JEE', '12500', '12500', '0', '0', 'UPI', '', 'UPI-48291034', '2026-10-05', '2026-10-03'],
      ['RN-102', 'Diya Patel', 'Tuition Fee - Core JEE', '12500', '6000', '500', '0', 'Cash', '', '', '2026-10-05', '2026-10-06'],
    ],
  },
}

type Props = { schoolId: string; initial: FeeSchema; onImported: () => Promise<unknown>; onClose: () => void }

/** Excel / CSV Bulk Data Upload & Formatting Guide, for fee structures and fee payments. */
export function FeeImportDialog({ schoolId, initial, onImported, onClose }: Props) {
  const [schema, setSchema] = useState<FeeSchema>(initial)
  const [file, setFile] = useState<File | null>(null)
  const [records, setRecords] = useState<Record<string, string>[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const s = SCHEMAS[schema]

  const send = (rows: Record<string, string>[], dryRun: boolean) =>
    api<ImportPreview>(`${feesPath(schoolId)}/${s.endpoint}`, { method: 'POST', body: JSON.stringify({ rows, dryRun }) })

  function switchTo(next: FeeSchema) {
    setSchema(next)
    setFile(null)
    setRecords(null)
    setPreview(null)
    setError(null)
  }

  async function choose(next: File | undefined) {
    if (!next) return
    setFile(next)
    setError(null)
    setPreview(null)
    setBusy(true)
    try {
      const { records: parsed, missing } = rowsToRecords(await readSpreadsheet(next), s.columns)
      if (missing.includes(s.requiredField)) throw new Error(`The file needs a "${s.requiredHeader}" column. Download the template to see the format.`)
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
    setError(null)
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

  const count = preview && !preview.applied ? preview.created + preview.updated : 0
  return (
    <Dialog
      title="Excel / CSV Bulk Data Upload & Formatting Guide"
      description="Check the column formats below, download a template, and import records after a preview"
      onClose={onClose}
      widthClass="max-w-4xl"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {(['structures', 'payments'] as const).map((k, i) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={schema === k}
              disabled={busy}
              onClick={() => switchTo(k)}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition ${schema === k ? (k === 'structures' ? 'bg-white text-indigo-700 shadow-sm' : 'bg-white text-emerald-700 shadow-sm') : 'text-slate-600 hover:text-slate-900'}`}
            >
              {k === 'structures' ? <Layers className="size-4" /> : <FileText className="size-4" />}
              {i + 1}. {SCHEMAS[k].title} Schema {schema === k ? '(Active)' : '(Switch)'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-bold tracking-wider text-slate-800 uppercase">
            <Table2 className="size-4 text-emerald-600" /> Required columns &amp; formatting ({s.title})
          </p>
          <button
            type="button"
            onClick={() => downloadFile(`fee-${schema}-template.csv`, toCsv(s.sample))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <Download className="size-3.5" /> Download Template (.csv)
          </button>
        </div>
        <div className="max-h-56 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Column Header</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Required?</th>
                <th className="px-3 py-2">Rules &amp; Example</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.spec.map((c) => (
                <tr key={c.header} className="align-top">
                  <td className={`px-3 py-2 font-mono font-semibold ${schema === 'structures' ? 'text-indigo-700' : 'text-emerald-700'}`}>{c.header}</td>
                  <td className="px-3 py-2 text-slate-600">{c.type}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${c.required ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{c.required ? 'Required' : 'Optional'}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {c.rule}
                    {c.example && <> Example: <code className="rounded bg-slate-100 px-1">{c.example}</code></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-indigo-200 hover:bg-slate-50'}`}
        >
          {busy ? <Loader2 className="size-6 animate-spin text-emerald-600" /> : <Upload className="size-6 text-emerald-600" />}
          <p className="mt-3 text-sm font-semibold text-slate-800">{file ? file.name : 'Click here or drop your Excel / CSV file'}</p>
          <p className="mt-1 text-xs text-slate-500">Supports .xlsx and .csv (save an old .xls as .xlsx first), up to {MAX_IMPORT_ROWS} rows</p>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
        </div>

        <ErrorBanner message={error} />
        {preview && <ImportPreviewTable preview={preview} />}
        {preview?.applied && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800"><Check className="size-4" /> Imported.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Info className="size-3.5" /> Every row is checked first; rows with problems are skipped and listed.</p>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">{preview?.applied ? 'Done' : 'Cancel'}</button>
          {!preview?.applied && (
            <button type="button" onClick={() => void apply()} disabled={!count || busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              <FileSpreadsheet className="size-4" /> Confirm &amp; Bulk Import ({count} Row{count === 1 ? '' : 's'})
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
