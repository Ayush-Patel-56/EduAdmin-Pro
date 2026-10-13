import { useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import { checkFile, formatSize, UPLOAD_RULES, uploadFile, type FilePurpose } from '@/lib/upload'

/** A file already attached to the record being edited. */
export type AttachedFile = { id: string; name: string; size?: number; url?: string | null }

type Props = {
  schoolId: string
  purpose: FilePurpose
  value: AttachedFile | null
  onChange: (file: AttachedFile | null) => void
  /** Reports upload errors (and clears them on a new pick). */
  onError: (message: string | null) => void
  onBusy?: (busy: boolean) => void
  title: string
  hint: string
  compact?: boolean
}

/** Pick a file: it uploads straight away (with progress) and the form keeps the returned id. */
export function FileField({ schoolId, purpose, value, onChange, onError, onBusy, title, hint, compact }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    const problem = checkFile(purpose, file)
    if (problem) return onError(problem)
    onError(null)
    setProgress(0)
    onBusy?.(true)
    try {
      const uploaded = await uploadFile(schoolId, purpose, file, setProgress)
      onChange({ id: uploaded.id, name: uploaded.name, size: uploaded.size, url: uploaded.url })
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setProgress(null)
      onBusy?.(false)
    }
  }

  const hidden = (
    <input
      ref={input}
      type="file"
      accept={UPLOAD_RULES[purpose].accept}
      className="hidden"
      onChange={(e) => {
        void pick(e.target.files?.[0])
        e.target.value = ''
      }}
    />
  )

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
        <FileText className="size-5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          {value.url ? (
            <a href={value.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-slate-800 hover:underline">
              {value.name}
            </a>
          ) : (
            <p className="truncate text-sm font-semibold text-slate-800">{value.name}</p>
          )}
          {value.size !== undefined && <p className="text-[11px] text-slate-500">{formatSize(value.size)}</p>}
        </div>
        <button type="button" onClick={() => input.current?.click()} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
          Replace
        </button>
        <button type="button" aria-label="Remove file" onClick={() => onChange(null)} className="rounded p-1 text-slate-400 hover:text-red-600">
          <X className="size-4" />
        </button>
        {hidden}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      disabled={progress !== null}
      className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-center transition hover:border-indigo-300 hover:bg-slate-50 disabled:opacity-70 ${compact ? 'gap-0 px-4 py-3' : 'gap-1 px-4 py-6'}`}
    >
      {progress !== null ? (
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Loader2 className="size-4 animate-spin" /> Uploading {Math.round(progress * 100)}%
        </span>
      ) : compact ? (
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Paperclip className="size-4 text-slate-400" /> {title}
        </span>
      ) : (
        <>
          <FileText className="size-6 text-emerald-600" />
          <span className="text-sm font-bold text-slate-800">{title}</span>
          <span className="text-[11px] text-slate-500">{hint}</span>
        </>
      )}
      {hidden}
    </button>
  )
}
