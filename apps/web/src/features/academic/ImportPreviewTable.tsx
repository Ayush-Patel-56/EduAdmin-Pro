import { CircleAlert, CirclePlus, RefreshCw } from 'lucide-react'
import type { ImportPreview } from './api'

const actionStyle = {
  create: { label: 'New', icon: CirclePlus, className: 'text-emerald-700 bg-emerald-50' },
  update: { label: 'Update', icon: RefreshCw, className: 'text-sky-700 bg-sky-50' },
  error: { label: 'Skip', icon: CircleAlert, className: 'text-red-700 bg-red-50' },
} as const

/** Row-by-row result of an import preview (or of the import itself). */
export function ImportPreviewTable({ preview }: { preview: ImportPreview }) {
  const problems = preview.rows.filter((r) => r.action === 'error')
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={preview.applied ? 'Created' : 'Will create'} value={preview.created} tone="text-emerald-700" />
        <Stat label={preview.applied ? 'Updated' : 'Will update'} value={preview.updated} tone="text-sky-700" />
        <Stat label={preview.applied ? 'Skipped' : 'Will skip'} value={preview.skipped} tone="text-red-700" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] tracking-wider text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...problems, ...preview.rows.filter((r) => r.action !== 'error')].map((r) => {
              const style = actionStyle[r.action]
              const Icon = style.icon
              return (
                <tr key={r.row} className="align-top">
                  <td className="px-3 py-2 text-slate-400">{r.row}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.label}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.className}`}>
                      <Icon className="size-3" /> {style.label}
                    </span>
                    {r.errors.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-[11px] text-red-600">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 py-2">
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</p>
    </div>
  )
}
