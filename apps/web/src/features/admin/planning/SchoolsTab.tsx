import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleCheck, Copy, Hash, Loader2, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnDanger, btnPrimary, btnSecondary, inputClass, labelClass } from '@/components/ui/formStyles'
import { meQueryKey } from '@/features/auth/session'
import type { Me } from '@/features/auth/types'
import { SchoolForm } from '@/features/onboarding/SchoolForm'
import { useSchoolOptions, type SchoolFormValues } from '@/features/onboarding/schoolOptions'
import type { MouStatus } from '../useDashboard'
import { useAdminContext } from '../adminContext'

type ApiSchool = { id: string; inviteCode: string; adminInviteCode: string; classesLabel: string; mouStatus: MouStatus; isOwner: boolean } &
  Omit<SchoolFormValues, 'mouStartDate' | 'mouEndDate' | 'contactPerson' | 'phone' | 'email' | 'address' | 'gstNumber'> & {
    mouStartDate: string | null
    mouEndDate: string | null
    contactPerson: string | null
    phone: string | null
    email: string | null
    address: string | null
    gstNumber: string | null
  }

const MOU_LABEL: Record<MouStatus, string> = { ACTIVE: 'Active', UPCOMING: 'Upcoming', EXPIRED: 'Expired', NOT_SET: 'Not set' }

type Modal =
  | { kind: 'add' }
  | { kind: 'join' }
  | { kind: 'edit'; school: ApiSchool }
  | { kind: 'delete'; school: ApiSchool }
  | { kind: 'clear'; school: ApiSchool }
  | null

export function SchoolsTab() {
  const { schoolId } = useAdminContext()
  const queryClient = useQueryClient()
  const { data: schools, error, isPending } = useQuery({
    queryKey: ['my-schools'],
    queryFn: () => api<ApiSchool[]>('/schools'),
  })
  const [modal, setModal] = useState<Modal>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  const refreshAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-schools'] }),
      queryClient.invalidateQueries({ queryKey: meQueryKey }),
    ])

  async function makeActive(id: string) {
    setSwitching(id)
    try {
      await api('/auth/active-school', { method: 'POST', body: JSON.stringify({ schoolId: id }) })
      queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, activeSchoolId: id } : old))
    } finally {
      setSwitching(null)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Manage all schools your account has access to. Switch the active school to view its data.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setModal({ kind: 'join' })} className={btnSecondary}>
            <Hash className="size-4" /> Join by Code
          </button>
          <button type="button" onClick={() => setModal({ kind: 'add' })} className={btnPrimary}>
            <Plus className="size-4" /> Add School
          </button>
        </div>
      </div>

      <div className="mt-6">
        <ErrorBanner message={error?.message} />
        {isPending && <Loader2 className="mx-auto size-6 animate-spin text-slate-300" aria-label="Loading" />}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {schools?.map((school) => (
            <SchoolCard
              key={school.id}
              school={school}
              active={school.id === schoolId}
              switching={switching === school.id}
              onActivate={() => makeActive(school.id)}
              onEdit={() => setModal({ kind: 'edit', school })}
              onDelete={() => setModal({ kind: 'delete', school })}
              onClear={() => setModal({ kind: 'clear', school })}
            />
          ))}
        </div>
      </div>

      {(modal?.kind === 'add' || modal?.kind === 'edit') && (
        <SchoolDialog school={modal.kind === 'edit' ? modal.school : undefined} onSaved={refreshAll} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'join' && <JoinSchoolDialog onJoined={refreshAll} onClose={() => setModal(null)} />}
      {modal?.kind === 'delete' && (
        <ConfirmNameDialog
          school={modal.school}
          title="Delete school"
          action="Delete School"
          description={
            <>
              This permanently deletes <strong>{modal.school.name}</strong> with all its programs, batches, syllabus,
              faculty profiles, announcements and memberships. Everyone loses access. This can’t be undone.
            </>
          }
          onConfirm={async (confirmName) => {
            await api(`/schools/${modal.school.id}`, { method: 'DELETE', body: JSON.stringify({ confirmName }) })
            queryClient.removeQueries({ queryKey: [modal.school.id] })
            await refreshAll()
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'clear' && <ClearDataDialog school={modal.school} onClose={() => setModal(null)} />}
    </>
  )
}

type SchoolCardProps = {
  school: ApiSchool
  active: boolean
  switching: boolean
  onActivate: () => void
  onEdit: () => void
  onDelete: () => void
  onClear: () => void
}

function SchoolCard({ school, active, switching, onActivate, onEdit, onDelete, onClear }: SchoolCardProps) {
  const ownerOnly = school.isOwner ? undefined : 'Only the school owner can do this'
  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${active ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'}`}
    >
      <div className={`h-1.5 ${active ? 'bg-indigo-600' : 'bg-slate-200'}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
              <span className="truncate">{school.name}</span>
              {active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                  <CircleCheck className="size-3" /> Active
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">{school.board}</p>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide ${
              school.isOwner ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            {school.isOwner ? 'OWNER' : 'ADMIN'}
          </span>
        </div>

        <dl className="mt-4 space-y-1.5 text-xs">
          <Row label="Classes" value={school.classesLabel || '—'} />
          <Row label="Programs" value={school.programs.join(', ') || '—'} />
          <Row label="MOU" value={MOU_LABEL[school.mouStatus]} />
        </dl>

        <CodeRow title="Teacher invite code" code={school.inviteCode} tone="amber" />
        <CodeRow title="Admin invite code" code={school.adminInviteCode} tone="indigo" />

        {!active && (
          <button type="button" onClick={onActivate} disabled={switching} className={`${btnSecondary} mt-3 h-9 w-full text-xs`}>
            {switching ? 'Switching…' : 'Switch to this school'}
          </button>
        )}
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={onEdit} disabled={!school.isOwner} title={ownerOnly} className={`${btnSecondary} h-9 text-xs`}>
            <Pencil className="size-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!school.isOwner}
            title={ownerOnly}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={!school.isOwner}
          title={ownerOnly}
          className="mx-auto mt-3 flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50 disabled:hover:no-underline"
        >
          <TriangleAlert className="size-3.5" /> Clear All Data
        </button>
      </div>
    </article>
  )
}

const CODE_TONES = {
  amber: { box: 'border-amber-200 bg-amber-50/70', title: 'text-amber-700', code: 'text-amber-900', button: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
  indigo: { box: 'border-indigo-200 bg-indigo-50/60', title: 'text-indigo-700', code: 'text-indigo-900', button: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' },
} as const

/** One invite code with a copy button. Teacher and admin codes are shown separately and labelled. */
function CodeRow({ title, code, tone }: { title: string; code: string; tone: keyof typeof CODE_TONES }) {
  const [copied, setCopied] = useState(false)
  const t = CODE_TONES[tone]
  return (
    <div className={`mt-3 flex items-center justify-between rounded-lg border px-3 py-2.5 ${t.box}`}>
      <div>
        <p className={`text-[10px] font-bold tracking-wider uppercase ${t.title}`}>{title}</p>
        <p className={`mt-0.5 font-mono text-sm font-bold tracking-[0.2em] ${t.code}`}>{code}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${t.button}`}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  )
}

function toFormValues(s: ApiSchool): SchoolFormValues {
  return {
    name: s.name,
    board: s.board,
    academicYearStartMonth: s.academicYearStartMonth,
    classes: s.classes,
    programs: s.programs,
    mouStartDate: s.mouStartDate ?? '',
    mouEndDate: s.mouEndDate ?? '',
    contactPerson: s.contactPerson ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    address: s.address ?? '',
    gstNumber: s.gstNumber ?? '',
  }
}

function SchoolDialog({ school, onSaved, onClose }: { school?: ApiSchool; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const { data: options, error } = useSchoolOptions()
  async function save(values: SchoolFormValues) {
    await api(school ? `/schools/${school.id}` : '/schools', {
      method: school ? 'PATCH' : 'POST',
      body: JSON.stringify(values),
    })
    await onSaved()
    onClose()
  }
  return (
    <Dialog title={school ? 'Edit School' : 'Create New School'} onClose={onClose} widthClass="max-w-lg">
      <div className="px-6 py-5">
        {options ? (
          <SchoolForm
            options={options}
            initial={school ? toFormValues(school) : undefined}
            onSubmit={save}
            onCancel={onClose}
            submitLabel={school ? 'Save Changes' : '+ Create School'}
            submittingLabel="Saving…"
            note={school ? 'Removing a program is only possible when it has no batches.' : 'A unique invite code will be auto-generated for this school.'}
          />
        ) : (
          <ErrorBanner message={error?.message} />
        )}
      </div>
    </Dialog>
  )
}

function JoinSchoolDialog({ onJoined, onClose }: { onJoined: () => Promise<unknown>; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return setError('Enter the school’s invite code')
    setBusy(true)
    try {
      await api('/schools/join', { method: 'POST', body: JSON.stringify({ inviteCode: code }) })
      await onJoined()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join')
      setBusy(false)
    }
  }
  return (
    <Dialog title="Join by Code" description="Enter the school’s admin invite code (an existing admin can copy it from their dashboard)" onClose={onClose} widthClass="max-w-md">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5">
        <div>
          <label htmlFor="join-code" className={labelClass}>School admin invite code</label>
          <input
            id="join-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setError(null)
            }}
            placeholder="e.g. GFCZ-BBYB"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            className={`${inputClass()} font-mono tracking-widest`}
          />
        </div>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Joining…' : 'Join School'}</button>
        </div>
      </form>
    </Dialog>
  )
}

type ConfirmNameDialogProps = {
  school: ApiSchool
  title: string
  action: string
  description: ReactNode
  extra?: ReactNode
  onConfirm: (confirmName: string) => Promise<void>
  onClose: () => void
}

/** Destructive school actions: the owner types the school name to confirm. */
function ConfirmNameDialog({ school, title, action, description, extra, onConfirm, onClose }: ConfirmNameDialogProps) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(typed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={onClose} widthClass="max-w-md">
      <form onSubmit={submit} noValidate className="space-y-4 px-6 py-5 text-sm text-slate-600">
        <p className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <TriangleAlert className="size-4 shrink-0" />
          <span>{description}</span>
        </p>
        {extra}
        <div>
          <label htmlFor="confirm-name" className={labelClass}>
            Type <span className="normal-case text-slate-900">{school.name}</span> to confirm
          </label>
          <input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" className={inputClass()} />
        </div>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={busy || typed.trim() !== school.name} className={btnDanger}>
            {busy ? 'Working…' : action}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

type ClearPreview = {
  programs: number
  batches: number
  syllabusItems: number
  importedFaculty: number
  announcements: number
  promotionCycles: number
  chapters: number
  concepts: number
}

function ClearDataDialog({ school, onClose }: { school: ApiSchool; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: preview } = useQuery({
    queryKey: [school.id, 'clear-preview'],
    queryFn: () => api<ClearPreview>(`/schools/${school.id}/clear-preview`),
    staleTime: 0,
  })
  const lines = preview && [
    [preview.programs, 'programs'],
    [preview.batches, 'batches'],
    [preview.syllabusItems, 'syllabus chapters'],
    [preview.chapters, 'curriculum chapters'],
    [preview.concepts, 'curriculum concepts'],
    [preview.importedFaculty, 'imported faculty profiles (without a login)'],
    [preview.announcements, 'announcements'],
    [preview.promotionCycles, 'promotion records'],
  ]
  return (
    <ConfirmNameDialog
      school={school}
      title="Clear all data"
      action="Clear All Data"
      description={
        <>
          Removes the academic data of <strong>{school.name}</strong>. The school, its members, their faculty profiles
          and the invite code stay. This can’t be undone.
        </>
      }
      extra={
        <div className="rounded-lg border border-slate-200 p-3 text-xs">
          <p className="mb-1.5 font-semibold text-slate-800">This will delete:</p>
          {lines ? (
            <ul className="space-y-0.5">
              {lines.map(([n, label]) => (
                <li key={label as string}>
                  <strong className="text-slate-900">{n}</strong> {label}
                </li>
              ))}
            </ul>
          ) : (
            <Loader2 className="size-4 animate-spin text-slate-300" aria-label="Loading" />
          )}
        </div>
      }
      onConfirm={async (confirmName) => {
        await api(`/schools/${school.id}/clear`, { method: 'POST', body: JSON.stringify({ confirmName }) })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [school.id] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard', school.id] }),
          queryClient.invalidateQueries({ queryKey: ['my-schools'] }),
        ])
      }}
      onClose={onClose}
    />
  )
}
