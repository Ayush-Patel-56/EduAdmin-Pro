import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { api } from '@/lib/api'
import { checkFile, UPLOAD_RULES, uploadFile } from '@/lib/upload'
import { EMAIL_PATTERN, isValidIndianMobile } from '@/lib/validators'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { Structure } from '@/features/academic/api'
import { STUDENT_STATUS_LABELS, useStudentOptions, type StudentDetail, type StudentStatus } from '@/features/students/api'
import { field } from './styles'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'
function F({ id, text, children, className, extra }: { id: string; text: string; children: ReactNode; className?: string; extra?: ReactNode }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className={label}>{text}</label>
        {extra}
      </div>
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

type Values = {
  fullName: string
  admissionNumber: string
  aadharNumber: string
  rollNumber: string
  email: string
  phone: string
  parentContact: string
  address: string
  city: string
  state: string
  pincode: string
  dateOfBirth: string
  gender: string
  bloodGroup: string
  profileImageUrl: string
  photoFileId: string
  previousSchool: string
  previousPercentage: string
  classLevel: string
  programId: string
  batchId: string
  admissionDate: string
  status: StudentStatus
  notes: string
}

const fromStudent = (s?: StudentDetail): Values => ({
  fullName: s?.fullName ?? '',
  admissionNumber: s?.admissionNumber ?? '',
  aadharNumber: s?.aadharNumber ?? '',
  rollNumber: s?.rollNumber ?? '',
  email: s?.email ?? '',
  phone: s?.phone ?? '',
  parentContact: s?.parentContact ?? '',
  address: s?.address ?? '',
  city: s?.city ?? '',
  state: s?.state ?? '',
  pincode: s?.pincode ?? '',
  dateOfBirth: s?.dateOfBirth ?? '',
  gender: s?.gender ?? '',
  bloodGroup: s?.bloodGroup ?? '',
  profileImageUrl: s?.profileImageUrl ?? '',
  photoFileId: s?.photoFileId ?? '',
  previousSchool: s?.previousSchool ?? '',
  previousPercentage: s?.previousPercentage === null || s?.previousPercentage === undefined ? '' : String(s.previousPercentage),
  classLevel: s?.classLevel ?? '',
  programId: s?.program?.id ?? '',
  batchId: s?.batch?.id ?? '',
  admissionDate: s?.admissionDate ?? '',
  status: s?.status ?? 'ACTIVE',
  notes: s?.notes ?? '',
})

/** Client-side checks; the API validates everything again. */
function problem(v: Values): string | null {
  if (!v.fullName.trim()) return 'Full name is required'
  if (v.aadharNumber && !/^[2-9]\d{11}$/.test(v.aadharNumber.replace(/[\s-]/g, ''))) return 'Aadhaar number must be 12 digits, not starting with 0 or 1'
  if (v.email && !EMAIL_PATTERN.test(v.email.trim())) return 'Enter a valid email address'
  if (v.phone && !isValidIndianMobile(v.phone)) return 'Phone must be a 10-digit mobile number'
  if (v.parentContact && !isValidIndianMobile(v.parentContact)) return 'Parent contact must be a 10-digit mobile number'
  if (v.pincode && !/^[1-9]\d{5}$/.test(v.pincode.trim())) return 'Pincode must be 6 digits'
  if (v.profileImageUrl && !/^https:\/\/\S+$/i.test(v.profileImageUrl.trim())) return 'Profile image must be an https:// link, or upload a file'
  if (v.previousPercentage) {
    const pct = Number(v.previousPercentage.replace(/%$/, '').trim())
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return 'Previous percentage must be between 0 and 100'
  }
  return null
}

type Props = {
  schoolId: string
  classes: string[]
  structure: Structure | undefined
  student?: StudentDetail
  onSaved: (id: string) => Promise<unknown> | void
  onClose: () => void
}

export function StudentFormDialog({ schoolId, classes, structure, student, onSaved, onClose }: Props) {
  const { data: options } = useStudentOptions()
  const [v, setV] = useState<Values>(() => fromStudent(student))
  const [photoPreview, setPhotoPreview] = useState<string | null>(student?.photoFileId ? student.photoUrl : null)
  const [photoName, setPhotoName] = useState<string | null>(student?.photoFileId ? 'Uploaded photo' : null)
  const [uploading, setUploading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (key: keyof Values, value: string) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  const programs = structure?.programs ?? []
  const batches = (structure?.batches ?? []).filter((b) => !v.programId || b.programId === v.programId)
  // A class the school stopped offering stays selectable on a student who has it.
  const classChoices = v.classLevel && !classes.includes(v.classLevel) ? [...classes, v.classLevel] : classes

  async function choosePhoto(file: File | undefined) {
    if (!file) return
    const issue = checkFile('STUDENT_PHOTO', file)
    if (issue) return setError(issue)
    setUploading(0)
    setError(null)
    try {
      const uploaded = await uploadFile(schoolId, 'STUDENT_PHOTO', file, setUploading)
      setV((prev) => ({ ...prev, photoFileId: uploaded.id, profileImageUrl: '' }))
      setPhotoPreview(uploaded.url)
      setPhotoName(uploaded.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const issue = problem(v)
    if (issue) return setError(issue)
    setBusy(true)
    setError(null)
    try {
      const body = JSON.stringify({ ...v, aadharNumber: v.aadharNumber.replace(/[\s-]/g, '') })
      const saved = student
        ? await api<{ id: string }>(`/schools/${schoolId}/students/${student.id}`, { method: 'PATCH', body })
        : await api<{ id: string }>(`/schools/${schoolId}/students`, { method: 'POST', body })
      await onSaved(saved.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const input = (key: keyof Values, extra?: { type?: string; placeholder?: string; inputMode?: 'numeric' | 'tel' | 'email'; maxLength?: number }) => (
    <input
      id={`st-${key}`}
      type={extra?.type ?? 'text'}
      value={v[key]}
      onChange={(e) => set(key, e.target.value)}
      placeholder={extra?.placeholder}
      inputMode={extra?.inputMode}
      maxLength={extra?.maxLength}
      className={field}
    />
  )

  return (
    <Dialog title={student ? 'Edit Student' : 'Add Student'} onClose={onClose} widthClass="max-w-3xl">
      <form onSubmit={submit} noValidate>
        <div className="space-y-7 px-6 py-5">
          <Section title="Identification">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="st-fullName" text="Full Name *">{input('fullName', { maxLength: 120 })}</F>
              <F id="st-admissionNumber" text="Admission Number">{input('admissionNumber', { maxLength: 40 })}</F>
              <F id="st-aadharNumber" text="Aadhar Number">{input('aadharNumber', { inputMode: 'numeric', placeholder: '12 digits', maxLength: 14 })}</F>
              <F id="st-rollNumber" text="Roll No">{input('rollNumber', { maxLength: 20 })}</F>
            </div>
          </Section>

          <Section title="Contact & Address">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="st-email" text="Email">{input('email', { type: 'email', inputMode: 'email' })}</F>
              <F id="st-phone" text="Phone">{input('phone', { inputMode: 'tel', maxLength: 14 })}</F>
              <F id="st-parentContact" text="Parent Contact">{input('parentContact', { inputMode: 'tel', maxLength: 14 })}</F>
              <F id="st-address" text="Address Line 1">{input('address', { maxLength: 300 })}</F>
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <F id="st-city" text="City">{input('city', { maxLength: 80 })}</F>
              <F id="st-state" text="State">{input('state', { maxLength: 80 })}</F>
              <F id="st-pincode" text="Pincode">{input('pincode', { inputMode: 'numeric', maxLength: 6 })}</F>
            </div>
          </Section>

          <Section title="Personal Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="st-dateOfBirth" text="Date of Birth">{input('dateOfBirth', { type: 'date' })}</F>
              <F id="st-gender" text="Gender">
                <select id="st-gender" value={v.gender} onChange={(e) => set('gender', e.target.value)} className={field}>
                  <option value="">Select...</option>
                  {options?.genders.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </F>
              <F id="st-bloodGroup" text="Blood Group">
                <select id="st-bloodGroup" value={v.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)} className={field}>
                  <option value="">Select...</option>
                  {options?.bloodGroups.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </F>
              <F
                id="st-profileImageUrl"
                text="Profile Image URL or File"
                extra={
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading !== null}
                    className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
                  >
                    {uploading !== null ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                    {uploading !== null ? `Uploading ${Math.round(uploading * 100)}%` : 'Upload File'}
                  </button>
                }
              >
                {v.photoFileId ? (
                  <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2">
                    {photoPreview && <img src={photoPreview} alt="" className="size-8 rounded-full object-cover" />}
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{photoName}</span>
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => {
                        setV((prev) => ({ ...prev, photoFileId: '' }))
                        setPhotoPreview(null)
                        setPhotoName(null)
                      }}
                      className="rounded p-1 text-slate-400 hover:text-red-600"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  input('profileImageUrl', { placeholder: 'https://... or click Upload File' })
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={UPLOAD_RULES.STUDENT_PHOTO.accept}
                  className="hidden"
                  onChange={(e) => {
                    void choosePhoto(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </F>
            </div>
          </Section>

          <Section title="Academic History">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="st-previousSchool" text="Previous School">{input('previousSchool', { maxLength: 150 })}</F>
              <F id="st-previousPercentage" text="Previous Percentage">{input('previousPercentage', { placeholder: 'e.g. 87%', inputMode: 'numeric', maxLength: 6 })}</F>
              <F id="st-classLevel" text="Current Class">
                <select id="st-classLevel" value={v.classLevel} onChange={(e) => set('classLevel', e.target.value)} className={field}>
                  <option value="">Select...</option>
                  {classChoices.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </F>
              <F id="st-programId" text="Program">
                <select
                  id="st-programId"
                  value={v.programId}
                  onChange={(e) => {
                    const programId = e.target.value
                    // A batch of another program can't stay selected.
                    const keep = (structure?.batches ?? []).some((b) => b.id === v.batchId && b.programId === programId)
                    setV((prev) => ({ ...prev, programId, batchId: keep ? prev.batchId : '' }))
                    setError(null)
                  }}
                  className={field}
                >
                  <option value="">Select...</option>
                  {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </F>
              <F id="st-batchId" text="Batch">
                <select
                  id="st-batchId"
                  value={v.batchId}
                  onChange={(e) => {
                    const batch = structure?.batches.find((b) => b.id === e.target.value)
                    setV((prev) => ({ ...prev, batchId: e.target.value, programId: batch ? batch.programId : prev.programId }))
                    setError(null)
                  }}
                  className={field}
                >
                  <option value="">Unassigned</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {!v.programId && ` (${programs.find((p) => p.id === b.programId)?.name ?? ''})`}
                    </option>
                  ))}
                </select>
              </F>
            </div>
          </Section>

          <Section title="Status & Metadata">
            <div className="grid gap-4 sm:grid-cols-2">
              <F id="st-admissionDate" text="Admission Date">{input('admissionDate', { type: 'date' })}</F>
              <F id="st-status" text="Status">
                <select id="st-status" value={v.status} onChange={(e) => set('status', e.target.value)} className={field}>
                  {(options?.statuses ?? (['ACTIVE'] as StudentStatus[])).map((s) => (
                    <option key={s} value={s}>{STUDENT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </F>
            </div>
            <F id="st-notes" text="Notes">
              <textarea
                id="st-notes"
                rows={3}
                value={v.notes}
                maxLength={2000}
                onChange={(e) => set('notes', e.target.value)}
                className={`${field.replace('h-11 ', '')} resize-y py-2.5`}
              />
            </F>
          </Section>
          <ErrorBanner message={error} />
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-slate-100 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || uploading !== null}
            className="h-12 rounded-xl bg-ink text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60"
          >
            {busy ? 'Saving…' : student ? 'Save Changes' : 'Add Student'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
