import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { EMAIL_PATTERN, isValidIndianMobile } from '@/lib/validators'
import { Dialog } from '@/components/ui/Dialog'
import { FileField, type AttachedFile } from '@/components/ui/FileField'
import { ErrorBanner } from '@/components/ui/form'
import { FACULTY_STATUS_LABELS, type FacultyStatus, type Structure } from '@/features/academic/api'
import { facultyApi, usePortalOptions, type FacultyDetail } from '@/features/faculty/api'
import { field } from '@/features/admin/students/styles'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'

function F({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="border-b border-slate-100 pb-2 text-xs font-extrabold tracking-[0.12em] text-slate-900 uppercase">{title}</h3>
      {children}
    </section>
  )
}

type Props = {
  schoolId: string
  faculty: FacultyDetail
  structure: Structure | undefined
  onSaved: () => Promise<unknown>
  onClose: () => void
}

/** Edit Faculty (PRD 4.7): every field of the profile, admins only. */
export function EditFacultyDialog({ schoolId, faculty: f, structure, onSaved, onClose }: Props) {
  const { data: options } = usePortalOptions(schoolId)
  const [v, setV] = useState({
    name: f.name,
    employeeId: f.employeeId ?? '',
    dateOfBirth: f.dateOfBirth ?? '',
    gender: f.gender ?? '',
    bio: f.bio ?? '',
    profileImageUrl: f.profileImageUrl ?? '',
    email: f.email ?? '',
    phone: f.phone ?? '',
    altPhone: f.altPhone ?? '',
    address: f.address ?? '',
    city: f.city ?? '',
    state: f.state ?? '',
    pincode: f.pincode ?? '',
    subject: f.primarySubject ?? '',
    specialization: f.specialization ?? '',
    qualification: f.qualification ?? '',
    primaryStream: f.primaryStream ?? '',
    experienceYears: f.experienceYears === null ? '' : String(f.experienceYears),
    joiningDate: f.joiningDate ?? '',
    status: f.status,
  })
  const [photo, setPhoto] = useState<AttachedFile | null>(f.photoFileId ? { id: f.photoFileId, name: 'Uploaded photo', url: f.photoUrl } : null)
  const [batchIds, setBatchIds] = useState<string[]>(f.batches.map((b) => b.id))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const set = (key: keyof typeof v, value: string) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  function problem() {
    if (!v.name.trim()) return 'Full name is required'
    if (!v.subject.trim()) return 'Subject is required'
    if (!v.specialization.trim()) return 'Specialisation is required'
    if (v.email && !EMAIL_PATTERN.test(v.email.trim())) return 'Enter a valid email address'
    if (v.phone && !isValidIndianMobile(v.phone)) return 'Phone must be a 10-digit mobile number'
    if (v.altPhone && !isValidIndianMobile(v.altPhone)) return 'Alt phone must be a 10-digit mobile number'
    if (v.pincode && !/^[1-9]\d{5}$/.test(v.pincode.trim())) return 'Pincode must be 6 digits'
    if (v.experienceYears && !/^\d{1,2}$/.test(v.experienceYears.trim())) return 'Experience must be a whole number of years'
    if (v.profileImageUrl && !photo && !/^https:\/\/\S+$/i.test(v.profileImageUrl.trim())) return 'Profile image must be an https:// link, or upload a file'
    return null
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const issue = problem()
    if (issue) return setError(issue)
    setBusy(true)
    try {
      await api(facultyApi(schoolId, f.id), {
        method: 'PATCH',
        body: JSON.stringify({
          ...v,
          experienceYears: v.experienceYears ? Number(v.experienceYears) : null,
          profileImageUrl: photo ? '' : v.profileImageUrl,
          photoFileId: photo?.id ?? null,
          batchIds,
        }),
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const input = (key: keyof typeof v, extra?: { type?: string; placeholder?: string; disabled?: boolean; inputMode?: 'tel' | 'numeric' | 'email' }) => (
    <input
      id={`ef-${key}`}
      type={extra?.type ?? 'text'}
      value={v[key]}
      disabled={extra?.disabled}
      placeholder={extra?.placeholder}
      inputMode={extra?.inputMode}
      onChange={(e) => set(key, e.target.value)}
      className={field}
    />
  )
  const programName = (id: string) => structure?.programs.find((p) => p.id === id)?.name ?? ''

  return (
    <Dialog title="Edit Faculty" description={f.linked ? 'This teacher signs in with their email, so it stays as it is.' : undefined} onClose={onClose} widthClass="max-w-3xl">
      <form onSubmit={submit} noValidate>
        <div className="space-y-7 px-6 py-5">
          <Section title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="ef-name" text="Full Name *">{input('name')}</F>
              <F id="ef-employeeId" text="Employee ID">{input('employeeId')}</F>
              <F id="ef-dateOfBirth" text="Date of Birth">{input('dateOfBirth', { type: 'date' })}</F>
              <F id="ef-gender" text="Gender">
                <select id="ef-gender" value={v.gender} onChange={(e) => set('gender', e.target.value)} className={field}>
                  <option value="">Select...</option>
                  {['Male', 'Female', 'Other'].map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </F>
              <F id="ef-bio" text="Bio" className="sm:col-span-2">
                <textarea id="ef-bio" rows={2} value={v.bio} maxLength={1000} onChange={(e) => set('bio', e.target.value)} className={`${field.replace('h-11 ', '')} resize-y py-2.5`} />
              </F>
              <div className="sm:col-span-2">
                <p className={label}>Profile Image</p>
                {photo ? (
                  <FileField schoolId={schoolId} purpose="FACULTY_PHOTO" value={photo} onChange={setPhoto} onError={setError} onBusy={setUploading} title="" hint="" />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    {input('profileImageUrl', { placeholder: 'https://... or upload a file' })}
                    <FileField schoolId={schoolId} purpose="FACULTY_PHOTO" value={null} onChange={setPhoto} onError={setError} onBusy={setUploading} title="Upload File" hint="" compact />
                  </div>
                )}
              </div>
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="ef-email" text="Email">{input('email', { type: 'email', disabled: f.linked, inputMode: 'email' })}</F>
              <F id="ef-phone" text="Phone">{input('phone', { inputMode: 'tel' })}</F>
              <F id="ef-altPhone" text="Alt Phone">{input('altPhone', { inputMode: 'tel' })}</F>
              <F id="ef-address" text="Address">{input('address')}</F>
              <F id="ef-city" text="City">{input('city')}</F>
              <F id="ef-state" text="State">{input('state')}</F>
              <F id="ef-pincode" text="Pincode">{input('pincode', { inputMode: 'numeric' })}</F>
            </div>
          </Section>

          <Section title="Professional">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="ef-subject" text="Subject *">{input('subject', { placeholder: 'e.g. Physics' })}</F>
              <F id="ef-specialization" text="Specialisation * (exam focus)">{input('specialization', { placeholder: 'e.g. JEE Main, NEET UG' })}</F>
              <F id="ef-qualification" text="Qualification">{input('qualification', { placeholder: 'e.g. M.Sc. Physics' })}</F>
              <F id="ef-primaryStream" text="Primary Stream">
                <select id="ef-primaryStream" value={v.primaryStream} onChange={(e) => set('primaryStream', e.target.value)} className={field}>
                  <option value="">Select...</option>
                  {options?.streams.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </F>
              <F id="ef-experienceYears" text="Experience (years)">{input('experienceYears', { inputMode: 'numeric' })}</F>
              <F id="ef-joiningDate" text="Joining Date">{input('joiningDate', { type: 'date' })}</F>
              <F id="ef-status" text="Status">
                <select id="ef-status" value={v.status} onChange={(e) => set('status', e.target.value as FacultyStatus)} className={field}>
                  {(Object.keys(FACULTY_STATUS_LABELS) as FacultyStatus[]).map((s) => <option key={s} value={s}>{FACULTY_STATUS_LABELS[s]}</option>)}
                </select>
              </F>
            </div>
            <div>
              <p className={label}>Batches</p>
              {(structure?.batches ?? []).length === 0 ? (
                <p className="text-xs text-slate-400 italic">This school has no batches yet.</p>
              ) : (
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-2">
                  {structure?.batches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={batchIds.includes(b.id)}
                        onChange={(e) => setBatchIds((ids) => (e.target.checked ? [...ids, b.id] : ids.filter((id) => id !== b.id)))}
                        className="size-4 accent-indigo-600"
                      />
                      {b.name} <span className="text-xs text-slate-400">({programName(b.programId)})</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-400">New batches start with the Primary role; change roles on the profile.</p>
            </div>
          </Section>
          <ErrorBanner message={error} />
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-slate-100 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={busy || uploading} className="h-12 rounded-xl bg-ink text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
