import { useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Dialog } from './Dialog'
import { ErrorBanner } from './form'

/** Choose PDF or CSV, then run the export; its error (if any) shows in the dialog. */
export function ExportDialog({ title, onClose, onExport }: { title: string; onClose: () => void; onExport: (format: 'pdf' | 'csv') => Promise<void> }) {
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onExport(format)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export')
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={onClose} widthClass="max-w-md">
      <div className="px-6 py-5">
        <p className="mb-3 text-xs font-bold tracking-wider text-slate-700 uppercase">Export Format</p>
        <div role="radiogroup" aria-label="Export format" className="grid grid-cols-2 gap-3">
          {(
            [
              ['pdf', 'PDF', FileText],
              ['csv', 'CSV', FileSpreadsheet],
            ] as const
          ).map(([key, text, Icon]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={format === key}
              onClick={() => setFormat(key)}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 py-5 text-sm font-semibold transition ${format === key ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              <Icon className="size-5" /> {text}
            </button>
          ))}
        </div>
        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      </div>
      <div className="flex justify-end gap-3 px-6 pb-6">
        <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={() => void run()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
          <Download className="size-4" /> {busy ? 'Generating…' : `Generate & Export ${format.toUpperCase()}`}
        </button>
      </div>
    </Dialog>
  )
}
