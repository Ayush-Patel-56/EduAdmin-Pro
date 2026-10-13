import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Pencil, Save, Star } from 'lucide-react'
import { api } from '@/lib/api'
import { isValidIndianMobile } from '@/lib/validators'
import { Dialog } from '@/components/ui/Dialog'
import { FileField, type AttachedFile } from '@/components/ui/FileField'
import { ErrorBanner } from '@/components/ui/form'
import { FACULTY_STATUS_LABELS } from '@/features/academic/api'
import { useMyProfile, type FacultyDetail } from '@/features/faculty/api'
import { formatDay } from '@/features/portal/format'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { field } from '@/features/admin/students/styles'

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v))

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{value}</p>
    </div>
  )
}

function View({ f, onEdit }: { f: FacultyDetail; onEdit: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <StudentAvatar name={f.name} photoUrl={f.photoUrl} size="size-14 text-lg" tone="bg-ink text-white" />
          <div>
            <p className="text-lg font-bold text-slate-900">{f.name}</p>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              {f.primarySubject ?? 'No subject yet'}
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase">{FACULTY_STATUS_LABELS[f.status]}</span>
            </p>
          </div>
        </div>
        <button type="button" onClick={onEdit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-50 px-3 text-xs font-semibold text-slate-800 hover:bg-blue-100">
          <Pencil className="size-3.5" /> Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Fact label="Email" value={dash(f.email)} />
        <Fact label="Phone" value={dash(f.phone)} />
        <Fact label="Date of Birth" value={f.dateOfBirth ? formatDay(f.dateOfBirth) : '—'} />
        <Fact label="Gender" value={dash(f.gender)} />
        <div className="col-span-2"><Fact label="Address" value={[f.address, f.city, f.state, f.pincode].filter(Boolean).join(', ') || '—'} /></div>
        <Fact label="Qualification" value={dash(f.qualification)} />
        <Fact label="Experience" value={f.experienceYears === null ? '—' : `${f.experienceYears} yr${f.experienceYears === 1 ? '' : 's'}`} />
        <Fact label="Primary Stream" value={dash(f.primaryStream)} />
        <Fact label="Joining Date" value={f.joiningDate ? formatDay(f.joiningDate) : '—'} />
      </div>
      <div>
        <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Subjects Taught</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {f.subjects.length === 0 && <span className="text-xs text-slate-400 italic">None yet</span>}
          {f.subjects.map((s) => (
            <span key={s} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${s === f.primarySubject ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}`}>
              {s} {s === f.primarySubject && <Star className="size-3 fill-current" />}
            </span>
          ))}
        </div>
      </div>
      <p className="text-center text-[11px] text-slate-400">Batch and subject assignments are managed by your school administration.</p>
    </div>
  )
}

function Edit({ f, schoolId, onDone }: { f: FacultyDetail; schoolId: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [v, setV] = useState({
    phone: f.phone ?? '',
    altPhone: f.altPhone ?? '',
    address: f.address ?? '',
    city: f.city ?? '',
    state: f.state ?? '',
    pincode: f.pincode ?? '',
    profileImageUrl: f.profileImageUrl ?? '',
  })
  const [photo, setPhoto] = useState<AttachedFile | null>(f.photoFileId ? { id: f.photoFileId, name: 'Your photo', url: f.photoUrl } : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = (key: keyof typeof v, value: string) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (v.phone && !isValidIndianMobile(v.phone)) return setError('Phone must be a 10-digit mobile number')
    if (v.altPhone && !isValidIndianMobile(v.altPhone)) return setError('Alternate phone must be a 10-digit mobile number')
    if (v.pincode && !/^[1-9]\d{5}$/.test(v.pincode.trim())) return setError('Pincode must be 6 digits')
    if (!photo && v.profileImageUrl && !/^https:\/\/\S+$/i.test(v.profileImageUrl.trim())) return setError('Profile image must be an https:// link, or upload a file')
    setBusy(true)
    try {
      await api('/teacher/profile', {
        method: 'PATCH',
        body: JSON.stringify({ ...v, profileImageUrl: photo ? '' : v.profileImageUrl, photoFileId: photo?.id ?? null }),
      })
      await queryClient.invalidateQueries({ queryKey: ['teacher-profile'] })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const input = (key: keyof typeof v, text: string, placeholder?: string) => (
    <div>
      <label htmlFor={`mp-${key}`} className="mb-1.5 block text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">{text}</label>
      <input id={`mp-${key}`} value={v[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} className={field} />
    </div>
  )

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">Profile Image URL or File</span>
        </div>
        {photo ? (
          <FileField schoolId={schoolId} purpose="FACULTY_PHOTO" value={photo} onChange={setPhoto} onError={setError} onBusy={setUploading} title="" hint="" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input aria-label="Profile image URL" value={v.profileImageUrl} onChange={(e) => set('profileImageUrl', e.target.value)} placeholder="https://... or click Upload File" className={field} />
            <FileField schoolId={schoolId} purpose="FACULTY_PHOTO" value={null} onChange={setPhoto} onError={setError} onBusy={setUploading} title="Upload File" hint="" compact />
          </div>
        )}
      </div>
      <p className="text-xs font-bold tracking-[0.12em] text-slate-400 uppercase">Contact Information</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {input('phone', 'Phone', '10-digit mobile number')}
        {input('altPhone', 'Alt Phone', 'Alternate phone')}
        {input('address', 'Address Line 1')}
        {input('city', 'City')}
        {input('state', 'State')}
        {input('pincode', 'Pincode')}
      </div>
      <p className="text-[11px] text-slate-400 italic">Professional details and identity can only be edited by the school administration.</p>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onDone} className="h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={busy || uploading} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
          <Save className="size-4" /> {busy ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

/** My Profile (opened from the avatar menu): read everything, edit only contact details and photo. */
export function MyProfileDialog({ schoolId, onClose }: { schoolId: string | null; onClose: () => void }) {
  const profile = useMyProfile(!!schoolId)
  const [editing, setEditing] = useState(false)
  return (
    <Dialog title={editing ? 'Edit My Profile' : 'My Profile'} onClose={onClose} widthClass={editing ? 'max-w-xl' : 'max-w-lg'}>
      <div className="px-6 py-5">
        {editing && (
          <button type="button" onClick={() => setEditing(false)} className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-3.5" /> Back to profile
          </button>
        )}
        {!schoolId ? (
          <p className="text-sm text-slate-500">Join a school to set up your faculty profile.</p>
        ) : profile.error ? (
          <ErrorBanner message={profile.error.message} />
        ) : !profile.data ? (
          <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />
        ) : editing ? (
          <Edit f={profile.data} schoolId={schoolId} onDone={() => setEditing(false)} />
        ) : (
          <View f={profile.data} onEdit={() => setEditing(true)} />
        )}
      </div>
    </Dialog>
  )
}
