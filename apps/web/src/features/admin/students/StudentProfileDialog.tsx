import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Mail, MessageCircle, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { EMAIL_PATTERN, isValidIndianMobile } from '@/lib/validators'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import { formatDay } from '@/features/portal/format'
import {
  STUDENT_STATUS_LABELS,
  useAdminStudent,
  useStudentOptions,
  type Guardian,
  type StudentDetail,
} from '@/features/students/api'
import { StudentAvatar } from '@/features/students/StudentAvatar'
import { field } from './styles'

const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v))

function Item({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <p className="mt-0.5 text-sm break-words text-slate-800">{value}</p>
    </div>
  )
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-extrabold tracking-[0.12em] text-slate-900 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** wa.me / mailto handoffs: the app doesn't send messages itself. */
function contactLinks(phone: string | null, email: string | null, studentName: string) {
  const text = encodeURIComponent(`Hello, this is regarding ${studentName}.`)
  return (
    <div className="flex gap-1.5">
      {phone && (
        <a
          href={`https://wa.me/91${phone}?text=${text}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          <MessageCircle className="size-3" /> WhatsApp
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}?subject=${encodeURIComponent(studentName)}`}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Mail className="size-3" /> Email
        </a>
      )}
    </div>
  )
}

type Props = {
  schoolId: string
  studentId: string
  onEdit: (student: StudentDetail) => void
  onDelete: (student: StudentDetail) => void
  onChanged: () => Promise<unknown>
  onClose: () => void
}

/** The admin's student profile (PRD 4.6): details, batch history and parents/guardians. */
export function StudentProfileDialog({ schoolId, studentId, onEdit, onDelete, onChanged, onClose }: Props) {
  const { data: student, error, isPending } = useAdminStudent(schoolId, studentId)
  const [guardian, setGuardian] = useState<Guardian | 'new' | null>(null)
  const [removing, setRemoving] = useState<Guardian | null>(null)

  return (
    <Dialog title="Student Profile" onClose={onClose} widthClass="max-w-3xl">
      <div className="space-y-4 px-6 py-5">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        {student && (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <StudentAvatar name={student.fullName} photoUrl={student.photoUrl} size="size-16 text-xl" />
                <div>
                  <p className="text-xl font-bold text-slate-900">{student.fullName}</p>
                  <p className="text-xs text-slate-500">
                    Roll {dash(student.rollNumber)} · Class {dash(student.classLevel)} · {student.batch?.name ?? 'Unassigned batch'}
                    {student.program && ` (${student.program.name})`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    ID {student.id.slice(0, 8)} · {STUDENT_STATUS_LABELS[student.status]}
                    {[student.address, student.city, student.state, student.pincode].some(Boolean) &&
                      ` · ${[student.address, student.city, student.state, student.pincode].filter(Boolean).join(', ')}`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(student)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="size-3.5" /> Edit Profile
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(student)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="size-3.5" /> Remove
                </button>
              </div>
            </div>

            <Block title="Identification & Contact">
              <div className="grid gap-4 sm:grid-cols-3">
                <Item label="Admission Number" value={dash(student.admissionNumber)} />
                <Item label="Aadhar Number" value={student.aadharNumber ? student.aadharNumber.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3') : '—'} />
                <Item label="Email" value={dash(student.email)} />
                <Item label="Phone" value={dash(student.phone)} />
                <Item label="Parent Contact" value={dash(student.parentContact)} />
              </div>
            </Block>

            <Block title="Personal & Academic">
              <div className="grid gap-4 sm:grid-cols-3">
                <Item label="Date of Birth" value={student.dateOfBirth ? formatDay(student.dateOfBirth) : '—'} />
                <Item label="Gender" value={dash(student.gender)} />
                <Item label="Blood Group" value={dash(student.bloodGroup)} />
                <Item label="Previous School" value={dash(student.previousSchool)} />
                <Item label="Previous %" value={student.previousPercentage === null ? '—' : `${student.previousPercentage}%`} />
                <Item label="Admission Date" value={student.admissionDate ? formatDay(student.admissionDate) : '—'} />
                {student.notes && <Item label="Notes" value={student.notes} className="sm:col-span-3" />}
              </div>
            </Block>

            <Block title="Batch Enrollments">
              {student.enrollments.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No batch enrollments recorded.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    <tr><th className="pb-2">Batch</th><th className="pb-2">Roll Number</th><th className="pb-2">Enrolled</th><th className="pb-2">Left</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {student.enrollments.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2 font-medium text-slate-800">{e.batch} <span className="text-xs text-slate-400">({e.program})</span></td>
                        <td className="py-2">{dash(e.rollNumber)}</td>
                        <td className="py-2">{e.enrolledOn ? formatDay(e.enrolledOn) : '—'}</td>
                        <td className="py-2">{e.endedOn ? formatDay(e.endedOn) : <span className="text-emerald-600">Current</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Block>

            <Block
              title="Parents / Guardians"
              action={
                <button
                  type="button"
                  onClick={() => setGuardian('new')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="size-3.5" /> Add Guardian
                </button>
              }
            >
              {student.guardians.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No parents or guardians recorded.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {student.guardians.map((g) => (
                    <li key={g.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                          {g.name}
                          {g.relationship && <span className="text-xs font-normal text-slate-500">({g.relationship})</span>}
                          {g.isPrimary && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                              <Star className="size-2.5" /> PRIMARY
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {[g.phone, g.altPhone, g.email, g.occupation, g.annualIncome !== null && `₹${g.annualIncome.toLocaleString('en-IN')}/yr`]
                            .filter(Boolean)
                            .join(' · ') || 'No contact details'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {contactLinks(g.phone, g.email, student.fullName)}
                        <button type="button" aria-label={`Edit ${g.name}`} onClick={() => setGuardian(g)} className="rounded p-1 text-slate-400 hover:text-indigo-600">
                          <Pencil className="size-4" />
                        </button>
                        <button type="button" aria-label={`Remove ${g.name}`} onClick={() => setRemoving(g)} className="rounded p-1 text-slate-400 hover:text-red-600">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </>
        )}
      </div>

      {student && guardian && (
        <GuardianDialog
          schoolId={schoolId}
          studentId={student.id}
          guardian={guardian === 'new' ? undefined : guardian}
          first={student.guardians.length === 0}
          onSaved={onChanged}
          onClose={() => setGuardian(null)}
        />
      )}
      {student && removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          message={<p>They will no longer be listed as a parent or guardian of {student.fullName}.</p>}
          confirmLabel="Remove"
          onConfirm={async () => {
            await api(`/schools/${schoolId}/students/${student.id}/guardians/${removing.id}`, { method: 'DELETE' })
            await onChanged()
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </Dialog>
  )
}

function GuardianDialog({
  schoolId,
  studentId,
  guardian,
  first,
  onSaved,
  onClose,
}: {
  schoolId: string
  studentId: string
  guardian?: Guardian
  first: boolean
  onSaved: () => Promise<unknown>
  onClose: () => void
}) {
  const { data: options } = useStudentOptions()
  const [v, setV] = useState({
    name: guardian?.name ?? '',
    relationship: guardian?.relationship ?? '',
    phone: guardian?.phone ?? '',
    altPhone: guardian?.altPhone ?? '',
    email: guardian?.email ?? '',
    occupation: guardian?.occupation ?? '',
    annualIncome: guardian?.annualIncome === null || guardian?.annualIncome === undefined ? '' : String(guardian.annualIncome),
    isPrimary: guardian?.isPrimary ?? first,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof v, value: string | boolean) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.name.trim()) return setError('Guardian name is required')
    if (v.phone && !isValidIndianMobile(v.phone)) return setError('Phone must be a 10-digit mobile number')
    if (v.altPhone && !isValidIndianMobile(v.altPhone)) return setError('Alt phone must be a 10-digit mobile number')
    if (v.email && !EMAIL_PATTERN.test(v.email.trim())) return setError('Enter a valid email address')
    if (v.annualIncome && !/^\d+$/.test(v.annualIncome.replace(/,/g, ''))) return setError('Annual income must be a whole number of rupees')
    setBusy(true)
    try {
      const body = JSON.stringify({ ...v, annualIncome: v.annualIncome ? Number(v.annualIncome.replace(/,/g, '')) : null })
      const base = `/schools/${schoolId}/students/${studentId}/guardians`
      await (guardian ? api(`${base}/${guardian.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body }))
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const text = (key: 'name' | 'phone' | 'altPhone' | 'email' | 'occupation' | 'annualIncome', label: string, extra?: { inputMode?: 'tel' | 'numeric' | 'email' }) => (
    <div>
      <label htmlFor={`g-${key}`} className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</label>
      <input id={`g-${key}`} value={v[key]} inputMode={extra?.inputMode} onChange={(e) => set(key, e.target.value)} className={field} />
    </div>
  )

  return (
    <Dialog title={guardian ? 'Edit Guardian' : 'Add Guardian'} onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Name *')}
          <div>
            <label htmlFor="g-relationship" className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">Relationship</label>
            <select id="g-relationship" value={v.relationship} onChange={(e) => set('relationship', e.target.value)} className={field}>
              <option value="">Select...</option>
              {options?.relationships.map((r) => <option key={r} value={r}>{r}</option>)}
              {v.relationship && !options?.relationships.includes(v.relationship) && <option value={v.relationship}>{v.relationship}</option>}
            </select>
          </div>
          {text('phone', 'Phone', { inputMode: 'tel' })}
          {text('altPhone', 'Alt Phone', { inputMode: 'tel' })}
          {text('email', 'Email', { inputMode: 'email' })}
          {text('occupation', 'Occupation')}
          {text('annualIncome', 'Annual Income (₹)', { inputMode: 'numeric' })}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={v.isPrimary} onChange={(e) => set('isPrimary', e.target.checked)} className="size-4 accent-indigo-600" />
          Primary contact
        </label>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={busy} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
            {busy ? 'Saving…' : 'Save Guardian'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
