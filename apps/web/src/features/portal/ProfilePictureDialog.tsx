import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { meQueryKey } from '@/features/auth/session'
import type { Me } from '@/features/auth/types'
import { resizeImage } from '@/lib/image'
import { Avatar } from './Avatar'

/** Profile Picture: a link to an image hosted online, or an uploaded file (resized here first). */
export function ProfilePictureDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(me.avatarUrl && !me.avatarUrl.startsWith('/api/') ? me.avatarUrl : '')
  const [image, setImage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const preview = image ?? (url.trim().startsWith('https://') ? url.trim() : me.avatarUrl)

  const done = (avatarUrl: string | null) => {
    queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, avatarUrl } : old))
    onClose()
  }

  async function choose(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setImage(await resizeImage(file))
      setFileName(file.name)
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image couldn't be read")
    }
  }

  async function save() {
    setError(null)
    if (!image && !url.trim()) return setError('Paste an https:// link to an image, or upload a file')
    if (!image && !url.trim().startsWith('https://')) return setError('Paste an https:// link to an image')
    setBusy(true)
    try {
      const out = image
        ? await api<{ avatarUrl: string }>('/auth/avatar/upload', { method: 'PUT', body: JSON.stringify({ image }) })
        : await api<{ avatarUrl: string }>('/auth/avatar/link', { method: 'PUT', body: JSON.stringify({ url: url.trim() }) })
      done(out.avatarUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the picture')
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api('/auth/avatar', { method: 'DELETE' })
      done(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the picture')
      setBusy(false)
    }
  }

  return (
    <Dialog title="Profile Picture" description="Paste a link to an image hosted online, or upload one" onClose={onClose} widthClass="max-w-sm">
      <div className="space-y-4 px-6 py-5">
        <div className="flex justify-center">
          <Avatar me={{ fullName: me.fullName, avatarUrl: preview }} className="size-20 rounded-full bg-emerald-500 text-2xl" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="avatar-url" className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Image URL or file</label>
            <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:underline">
              <Upload className="size-3.5" /> Upload File
            </button>
          </div>
          <input
            id="avatar-url"
            value={fileName ? `Uploaded: ${fileName}` : url}
            readOnly={!!fileName}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
            onFocus={() => {
              if (fileName) {
                setFileName(null)
                setImage(null)
              }
            }}
            placeholder="https://… or click Upload File"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
          />
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
          <p className="mt-1.5 text-[11px] text-slate-400">An uploaded image is cropped to a square and resized. Only you see it.</p>
        </div>
        <ErrorBanner message={error} />
        <button type="button" onClick={() => void save()} disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60">
          {busy && <Loader2 className="size-4 animate-spin" />} Save Photo
        </button>
        {me.avatarUrl && (
          <button type="button" onClick={() => void remove()} disabled={busy} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
            <Trash2 className="size-3.5" /> Remove photo
          </button>
        )}
      </div>
    </Dialog>
  )
}
