import { useState } from 'react'
import { CalendarPlus, ExternalLink, Loader2, Mail, Phone } from 'lucide-react'
import { ConfirmDialog, ErrorBanner } from '@/components/ui/form'
import {
  MODE_LABELS,
  RATING_LABELS,
  RESULT_LABELS,
  RESULT_STYLES,
  STAGE_LABELS,
  STAGE_STYLES,
  formatInr,
  useCandidates,
  useInterviews,
  useMySchools,
  useRecruitmentOptions,
  useRecruitmentWrite,
  type Candidate,
  type Interview,
  type Overview,
  type Stage,
} from './api'
import { EmptyRow, Pill, RowActions, Stars, Toolbar } from './shared'
import { useDebounced } from './useDebounced'

type CandidatesTabProps = {
  view: 'profiles' | 'interviews'
  onViewChange: (view: 'profiles' | 'interviews') => void
  counts: Overview['counts'] | undefined
  onEditCandidate: (c: Candidate) => void
  onSchedule: (candidateId?: string) => void
  onEditInterview: (i: Interview) => void
}

export function CandidatesTab({ view, onViewChange, counts, onEditCandidate, onSchedule, onEditInterview }: CandidatesTabProps) {
  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Candidate views" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(
            [
              ['profiles', `Candidate Profiles (${counts?.candidates ?? 0})`],
              ['interviews', `Interview Logistics & Evaluation (${counts?.interviews ?? 0})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => onViewChange(id)}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${view === id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'interviews' && (
          <button
            type="button"
            onClick={() => onSchedule()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <CalendarPlus className="size-4" /> Schedule / Log Interview
          </button>
        )}
      </div>
      <div className="mt-4">
        {view === 'profiles' ? (
          <Profiles onEdit={onEditCandidate} onSchedule={onSchedule} />
        ) : (
          <Interviews onEdit={onEditInterview} />
        )}
      </div>
    </>
  )
}

function Profiles({ onEdit, onSchedule }: { onEdit: (c: Candidate) => void; onSchedule: (candidateId: string) => void }) {
  const { data: options } = useRecruitmentOptions()
  const { data: schools } = useMySchools()
  const [search, setSearch] = useState('')
  const [schoolId, setSchoolId] = useState('')
  const [stage, setStage] = useState('')
  const q = useDebounced(search)
  const { data: rows, error, isPending } = useCandidates({ q, schoolId, stage })
  const write = useRecruitmentWrite()
  const [deleting, setDeleting] = useState<Candidate | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const select = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 focus:border-indigo-300 focus:outline-none'

  async function changeStage(c: Candidate, next: Stage) {
    setActionError(null)
    setNotice(null)
    try {
      const result = await write<{ facultyCreated: { name: string } | null }>(`/candidates/${c.id}/stage`, 'PATCH', { stage: next })
      if (result.facultyCreated) setNotice(`${result.facultyCreated.name} was added to the school’s faculty (Academic Planning → Faculty).`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the status')
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
        <Toolbar search={search} onSearch={setSearch} placeholder="Search candidate name, role, email...">
          <select aria-label="School" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className={select}>
            <option value="">All Schools ({schools?.length ?? 0})</option>
            {schools?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className={select}>
            <option value="">All Stages</option>
            {options?.candidateStages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </Toolbar>
      </div>
      {(actionError || notice) && (
        <div className="space-y-2 px-4 pt-4">
          <ErrorBanner message={actionError} />
          {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">{notice}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-slate-200 text-[11px] font-bold tracking-wider text-slate-700 uppercase">
            <tr>
              <th className="px-5 py-3.5">Candidate Profile</th>
              <th className="px-5 py-3.5">Role &amp; Department</th>
              <th className="px-5 py-3.5">Experience &amp; Org</th>
              <th className="px-5 py-3.5">Expected Salary</th>
              <th className="px-5 py-3.5">Resume</th>
              <th className="px-5 py-3.5">Workflow Status</th>
              <th className="px-5 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isPending && <tr><td colSpan={7} className="py-10"><Loader2 className="mx-auto size-5 animate-spin text-slate-300" aria-label="Loading" /></td></tr>}
            {error && <tr><td colSpan={7} className="p-4"><ErrorBanner message={error.message} /></td></tr>}
            {rows?.length === 0 && (
              <EmptyRow colSpan={7}>
                {q || schoolId || stage ? 'No candidates match these filters.' : 'No candidate profiles found. Click "Add Candidate" to get started.'}
              </EmptyRow>
            )}
            {rows?.map((c) => (
              <tr key={c.id} className="align-top hover:bg-slate-50/60">
                <td className="px-5 py-3.5">
                  <div className="flex gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700">
                      {c.fullName.trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{c.fullName}</p>
                      {c.email && <p className="flex items-center gap-1 text-[11px] text-slate-500"><Mail className="size-3" /> {c.email}</p>}
                      {c.phone && <p className="flex items-center gap-1 text-[11px] text-slate-500"><Phone className="size-3" /> {c.phone}</p>}
                      <p className="text-[11px] text-slate-400">{c.schoolName}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <p className="text-slate-800">{c.roleApplied}</p>
                  <p className="text-xs text-slate-500">{c.department ?? '—'}</p>
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-600">
                  <p>{c.experienceYears === null ? '—' : `${c.experienceYears} yr${c.experienceYears === 1 ? '' : 's'}`}</p>
                  <p className="text-slate-400">{c.currentOrganization ?? ''}</p>
                  {c.qualification && <p className="text-slate-400">{c.qualification}</p>}
                </td>
                <td className="px-5 py-3.5 text-slate-800">{c.expectedSalary === null ? '—' : <>{formatInr(c.expectedSalary)}<span className="text-xs text-slate-400"> / yr</span></>}</td>
                <td className="px-5 py-3.5">
                  {c.resumeUrl ? (
                    <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">
                      View <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <label className="sr-only" htmlFor={`cand-stage-${c.id}`}>Workflow status of {c.fullName}</label>
                  <select
                    id={`cand-stage-${c.id}`}
                    value={c.stage}
                    onChange={(e) => changeStage(c, e.target.value as Stage)}
                    className={`h-8 rounded-full border-0 px-3 text-[11px] font-bold focus:ring-2 focus:ring-indigo-200 focus:outline-none ${STAGE_STYLES[c.stage]}`}
                  >
                    {options?.candidateStages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                </td>
                <td className="px-5 py-3.5">
                  <RowActions label={c.fullName} onEdit={() => onEdit(c)} onDelete={() => setDeleting(c)}>
                    <button type="button" onClick={() => onSchedule(c.id)} aria-label={`Schedule interview for ${c.fullName}`} title="Schedule interview" className="rounded p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                      <CalendarPlus className="size-4" />
                    </button>
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete candidate?"
          message={
            <>
              <strong className="text-slate-900">{deleting.fullName}</strong>
              {deleting.interviewCount > 0 && <> and {deleting.interviewCount} interview record{deleting.interviewCount === 1 ? '' : 's'}</>} will be
              removed. The deletion is recorded in the audit log.
            </>
          }
          confirmLabel="Delete Candidate"
          onConfirm={async () => {
            await write(`/candidates/${deleting.id}`, 'DELETE')
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function Interviews({ onEdit }: { onEdit: (i: Interview) => void }) {
  const { data: rows, error, isPending } = useInterviews({})
  const write = useRecruitmentWrite()
  const [now] = useState(() => Date.now())
  const [deleting, setDeleting] = useState<Interview | null>(null)

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead className="border-b border-slate-200 text-[11px] font-bold tracking-wider text-slate-700 uppercase">
          <tr>
            <th className="px-5 py-3.5">Candidate &amp; Panel</th>
            <th className="px-5 py-3.5">Date &amp; Mode</th>
            <th className="px-5 py-3.5">Location / Link</th>
            <th className="px-5 py-3.5">Rating</th>
            <th className="px-5 py-3.5">Feedback Evaluation</th>
            <th className="px-5 py-3.5">Final Result</th>
            <th className="px-5 py-3.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isPending && <tr><td colSpan={7} className="py-10"><Loader2 className="mx-auto size-5 animate-spin text-slate-300" aria-label="Loading" /></td></tr>}
          {error && <tr><td colSpan={7} className="p-4"><ErrorBanner message={error.message} /></td></tr>}
          {rows?.length === 0 && <EmptyRow colSpan={7}>No interview evaluations recorded yet. Click "Schedule / Log Interview" to add one.</EmptyRow>}
          {rows?.map((i) => {
            const when = new Date(i.scheduledAt)
            const upcoming = when.getTime() > now && i.result === 'PENDING'
            return (
              <tr key={i.id} className="align-top hover:bg-slate-50/60">
                <td className="px-5 py-3.5">
                  <p className="font-semibold text-slate-900">{i.candidate.fullName}</p>
                  <p className="text-xs text-slate-500">{i.candidate.roleApplied} · {i.schoolName}</p>
                  {i.panel && <p className="mt-0.5 text-[11px] text-slate-400">Panel: {i.panel}</p>}
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-700">
                  <p>{when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  <p className="text-slate-400">{MODE_LABELS[i.mode]}{upcoming && ' · upcoming'}</p>
                </td>
                <td className="max-w-56 px-5 py-3.5 text-xs break-words text-slate-600">
                  {i.location && /^https?:\/\//i.test(i.location) ? (
                    <a href={i.location} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline">
                      Join link <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    (i.location ?? '—')
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <Stars value={i.rating} />
                  {i.rating !== null && <p className="text-[11px] text-slate-500">{RATING_LABELS[i.rating]}</p>}
                </td>
                <td className="max-w-72 px-5 py-3.5 text-xs whitespace-pre-line text-slate-600">{i.feedback ?? '—'}</td>
                <td className="px-5 py-3.5"><Pill className={RESULT_STYLES[i.result]}>{RESULT_LABELS[i.result]}</Pill></td>
                <td className="px-5 py-3.5"><RowActions label={`interview of ${i.candidate.fullName}`} onEdit={() => onEdit(i)} onDelete={() => setDeleting(i)} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {deleting && (
        <ConfirmDialog
          title="Delete interview record?"
          message={<>The interview of <strong className="text-slate-900">{deleting.candidate.fullName}</strong> will be removed. The deletion is recorded in the audit log.</>}
          confirmLabel="Delete"
          onConfirm={async () => {
            await write(`/interviews/${deleting.id}`, 'DELETE')
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
