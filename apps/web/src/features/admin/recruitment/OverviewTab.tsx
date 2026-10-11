import { useState } from 'react'
import { Briefcase, CalendarDays, ChevronRight, CircleCheck, Clock, Loader2, Medal, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { STAGE_LABELS, useMySchools, useRecruitmentOptions, useRecruitmentWrite, type Overview, type Stage } from './api'

type OverviewTabProps = {
  overview: Overview | undefined
  loading: boolean
  boardSchool: string
  onBoardSchoolChange: (id: string) => void
  onViewAll: () => void
}

export function OverviewTab({ overview, loading, boardSchool, onBoardSchoolChange, onViewAll }: OverviewTabProps) {
  const { data: options } = useRecruitmentOptions()
  const { data: schools } = useMySchools()
  const write = useRecruitmentWrite()
  const [moving, setMoving] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const k = overview?.kpis

  async function move(id: string, stage: Stage) {
    setMoving(id)
    setMoveError(null)
    try {
      await write(`/candidates/${id}/stage`, 'PATCH', { stage })
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Could not move the candidate')
    } finally {
      setMoving(null)
    }
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={Briefcase} label="Open Vacancies" value={k?.openVacancies.value} hint={k ? `Across ${k.openVacancies.roles} active role${k.openVacancies.roles === 1 ? '' : 's'}` : 'Active roles'} week={k?.openVacancies.newThisWeek} />
        <KpiCard icon={Users} label="Active Candidates" value={k?.activeCandidates.value} hint="In hiring pipeline" week={k?.activeCandidates.newThisWeek} />
        <KpiCard icon={CalendarDays} label="Interviews Scheduled" value={k?.interviewsScheduled.value} hint="Upcoming sessions" week={k?.interviewsScheduled.newThisWeek} />
        <KpiCard icon={Medal} label="Pending Appraisals" value={k?.pendingAppraisals.value} hint="Requires review" week={k?.pendingAppraisals.newThisWeek} />
        <KpiCard icon={CircleCheck} label="Hired This Year" value={k?.hiredThisYear.value} hint="Successfully onboarded" week={k?.hiredThisYear.newThisWeek} />
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Hiring Pipeline Board</h2>
              <p className="text-xs text-slate-500">Drag-free interactive workflow status across all candidate stages</p>
            </div>
            <select
              aria-label="School"
              value={boardSchool}
              onChange={(e) => onBoardSchoolChange(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-indigo-300 focus:outline-none"
            >
              <option value="">All Schools ({schools?.length ?? 0})</option>
              {schools?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={onViewAll} className="inline-flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-700">
            View All Candidates <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="mt-4"><ErrorBanner message={moveError} /></div>
        <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
          {(options?.pipelineStages ?? []).map((stage) => {
            const cards = overview?.pipeline.filter((c) => c.stage === stage) ?? []
            return (
              <div key={stage} className="flex min-h-[420px] w-72 shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                <header className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <h3 className="text-xs font-bold tracking-wider text-slate-800 uppercase">{STAGE_LABELS[stage]}</h3>
                  <span className="min-w-5 rounded-full bg-slate-200/70 px-1.5 py-0.5 text-center text-[10px] font-bold text-slate-600">{cards.length}</span>
                </header>
                <div className="mt-3 flex flex-1 flex-col gap-3">
                  {loading ? (
                    <Loader2 className="m-auto size-5 animate-spin text-slate-300" aria-label="Loading" />
                  ) : cards.length === 0 ? (
                    <p className="m-auto text-xs text-slate-400">No candidates in this stage</p>
                  ) : (
                    cards.map((c) => (
                      <article key={c.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-900">{c.fullName}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{c.roleApplied}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {c.schoolName}
                          {c.department && ` · ${c.department}`}
                        </p>
                        <label className="sr-only" htmlFor={`stage-${c.id}`}>Move {c.fullName} to</label>
                        <div className="mt-2.5 flex items-center gap-2">
                          <select
                            id={`stage-${c.id}`}
                            value={c.stage}
                            disabled={moving === c.id}
                            onChange={(e) => move(c.id, e.target.value as Stage)}
                            className="h-7 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 focus:outline-none"
                          >
                            {(options?.candidateStages ?? []).map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                          </select>
                          {moving === c.id && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}

type KpiCardProps = { icon: LucideIcon; label: string; value: number | undefined; hint: string; week: number | undefined }

/** The chip shows real movement: how many were added in the last 7 days, or "Stable". */
function KpiCard({ icon: Icon, label, value, hint, week }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="pt-2 text-xs font-bold tracking-wider text-slate-600 uppercase">{label}</p>
        <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-black text-slate-900">{value ?? '–'}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{hint}</p>
        {week !== undefined &&
          (week > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700" title="Added in the last 7 days">
              <TrendingUp className="size-3" /> +{week} this week
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600" title="Nothing new in the last 7 days">
              <Clock className="size-3" /> Stable
            </span>
          ))}
      </div>
    </div>
  )
}
