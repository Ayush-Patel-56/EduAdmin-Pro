import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, FileQuestion, ListChecks, Percent, Plus } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { formatDay } from '@/features/portal/format'
import { assessmentsBase, time12, useAssessmentOptions, useInvalidateAssessments, useOverview, useTests, weekDays, type Options, type Overview } from '@/features/assessments/api'
import { QuestionBank } from '@/features/assessments/QuestionBank'
import { TestDialog } from '@/features/assessments/TestDialog'
import { TestsTable } from '@/features/assessments/TestsTable'
import { TestWorkspace } from '@/features/assessments/TestWorkspace'
import { Card, Kpi, PhaseBadge, Spinner, Tabs } from '@/features/assessments/ui'
import { useAdminContext } from '../adminContext'

type Tab = 'calendar' | 'tests' | 'questions'
const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: 'calendar', label: 'Test Calendar', icon: CalendarDays },
  { key: 'tests', label: 'All Tests', icon: ListChecks },
  { key: 'questions', label: 'Question Bank Overview', icon: FileQuestion },
]

/** Tests & Question Bank (PRD 4.10): schedule tests, see every test and the school's question bank. */
export function TestsBankPage() {
  const { schoolId, dashboard } = useAdminContext()
  const base = assessmentsBase(schoolId)
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'calendar') as Tab
  const testId = params.get('test')
  const options = useAssessmentOptions(base)
  const overview = useOverview(base)
  const institute = dashboard?.school.name ?? ''
  const go = (next: Record<string, string>) => setParams(next, { replace: false })
  const k = overview.data?.kpis

  return (
    <>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Tests &amp; Question Bank</h1>
        <p className="mt-1 text-sm text-slate-500">Schedule tests, track results and manage the school’s question bank</p>
      </div>
      {(options.error || overview.error) && (
        <div className="mt-4">
          <ErrorBanner message={(options.error ?? overview.error)!.message} />
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Scheduled This Week" value={k?.scheduledThisWeek ?? '–'} hint="Monday to Sunday, not cancelled" icon={CalendarClock} tone="bg-blue-50 text-blue-600" />
        <Kpi label="Total Questions" value={k?.totalQuestions ?? '–'} hint="In the question bank" icon={FileQuestion} tone="bg-indigo-50 text-indigo-600" />
        <Kpi label="Avg Score" value={k ? (k.averageScore === null ? '—' : `${k.averageScore}%`) : '–'} hint={k && k.averageScore === null ? 'No results yet' : 'Across all graded tests'} icon={Percent} tone="bg-emerald-50 text-emerald-600" />
        <Kpi label="Pending Grading" value={k?.pendingGrading ?? '–'} hint="Finished tests with students not graded" icon={ClipboardCheck} tone="bg-amber-50 text-amber-600" />
      </div>

      <div className="mt-8">
        {testId && options.data ? (
          <TestWorkspace base={base} testId={testId} options={options.data} institute={institute} onBack={() => go({ tab })} />
        ) : (
          <>
            <Tabs label="Tests and question bank" tabs={TABS} value={tab} onChange={(t) => go({ tab: t })} />
            <div className="mt-5">
              {!options.data ? (
                <Spinner />
              ) : tab === 'calendar' ? (
                <TestCalendar base={base} options={options.data} overview={overview.data} onOpen={(id) => go({ tab, test: id })} />
              ) : tab === 'tests' ? (
                <TestsTable base={base} options={options.data} variant="admin" onOpen={(id) => go({ tab, test: id })} />
              ) : (
                <QuestionBank base={base} options={options.data} variant="admin" institute={institute} />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const dayNum = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const shift = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)

function TestCalendar({ base, options, overview, onOpen }: { base: string; options: Options; overview: Overview | undefined; onOpen: (id: string) => void }) {
  const [offset, setOffset] = useState(0)
  const [scheduling, setScheduling] = useState<string | null>(null)
  const invalidate = useInvalidateAssessments(base)
  const thisWeek = overview?.week.from
  const from = thisWeek ? shift(thisWeek, offset * 7) : null
  const days = from ? weekDays(from) : []
  const week = useTests(base, from ? { from, to: days[6], pageSize: 200 } : { pageSize: 1 })
  const tests = from ? (week.data?.items ?? []) : []

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Test Calendar</h2>
            <p className="mt-0.5 text-xs text-slate-500">{from ? `${formatDay(days[0])} – ${formatDay(days[6])}` : 'Loading…'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-slate-200">
              <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)} className="p-2 text-slate-600 hover:bg-slate-50">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" onClick={() => setOffset(0)} disabled={offset === 0} className="border-x border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:text-slate-400">
                This week
              </button>
              <button type="button" aria-label="Next week" onClick={() => setOffset((o) => o + 1)} className="p-2 text-slate-600 hover:bg-slate-50">
                <ChevronRight className="size-4" />
              </button>
            </div>
            <button type="button" onClick={() => setScheduling('')} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-semibold text-white hover:bg-ink-hover">
              <Plus className="size-4" /> Schedule Test
            </button>
          </div>
        </div>
        {week.error && (
          <div className="p-4">
            <ErrorBanner message={week.error.message} />
          </div>
        )}
        <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-7 md:divide-x md:divide-y-0">
          {days.map((day) => {
            const list = tests.filter((t) => t.date === day)
            const today = day === options.today
            return (
              <div key={day} className={`group flex min-h-0 flex-col gap-2 p-3 md:min-h-44 ${today ? 'bg-indigo-50/40' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-[11px] font-bold tracking-wider uppercase ${today ? 'text-indigo-700' : 'text-slate-500'}`}>{dayName.format(new Date(`${day}T00:00:00Z`))}</p>
                    <p className={`text-sm font-bold ${today ? 'text-indigo-700' : 'text-slate-900'}`}>{dayNum.format(new Date(`${day}T00:00:00Z`))}</p>
                  </div>
                  <button type="button" aria-label={`Schedule a test on ${formatDay(day)}`} onClick={() => setScheduling(day)} className="rounded-md p-1 text-slate-300 transition group-hover:text-slate-500 hover:bg-white hover:text-slate-800">
                    <Plus className="size-4" />
                  </button>
                </div>
                {list.map((t) => (
                  <button key={t.id} type="button" onClick={() => onOpen(t.id)} className={`rounded-lg border px-2.5 py-2 text-left transition hover:shadow-sm ${t.phase === 'CANCELLED' ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-indigo-100 bg-white'}`}>
                    <span className={`line-clamp-2 text-xs font-semibold text-slate-900 ${t.phase === 'CANCELLED' ? 'line-through' : ''}`}>{t.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {time12(t.time)} · {t.batch.name}
                    </span>
                    <span className="mt-1 block">
                      <PhaseBadge value={t.phase} />
                    </span>
                  </button>
                ))}
                {!list.length && <p className="text-[11px] text-slate-300 md:mt-auto">No tests</p>}
              </div>
            )
          })}
        </div>
      </Card>

      <BatchAverages overview={overview} />

      {scheduling !== null && <TestDialog base={base} options={options} test={null} date={scheduling || undefined} title="Schedule New Test" onSaved={invalidate} onClose={() => setScheduling(null)} />}
    </div>
  )
}

/** Average % per batch on its most recent graded mock test (PRD 4.10). */
function BatchAverages({ overview }: { overview: Overview | undefined }) {
  const bars = overview?.batchAverages ?? []
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Average % per Batch</h2>
          <p className="mt-0.5 text-xs text-slate-500">Each batch’s most recent graded mock test, of the students present</p>
        </div>
        <BarChart3 className="size-5 text-slate-300" />
      </div>
      {!overview ? (
        <Spinner />
      ) : !bars.length ? (
        <p className="py-12 text-center text-sm text-slate-400">No graded mock tests yet. Batch averages appear once mock test results are saved.</p>
      ) : (
        <div className="mt-8 flex gap-2">
          <div className="relative h-40 w-9 shrink-0 text-[10px] text-slate-400 tabular-nums" aria-hidden>
            {[100, 75, 50, 25, 0].map((n) => (
              <span key={n} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - n}%` }}>
                {n}%
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <ul className="flex min-w-max gap-3 sm:min-w-0">
              {bars.map((b) => (
                <li key={b.batch.id} className="flex w-20 flex-1 flex-col items-center" title={`${b.test.title} (${formatDay(b.test.date)}), ${b.students} students`}>
                  <div className="relative h-40 w-full border-b border-slate-200">
                    {[25, 50, 75, 100].map((n) => (
                      <div key={n} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: `${100 - n}%` }} />
                    ))}
                    <div className={`absolute bottom-0 left-1/2 w-10 -translate-x-1/2 rounded-t-md ${b.averagePercent >= 50 ? 'bg-indigo-500' : 'bg-amber-400'}`} style={{ height: `${Math.max(1, Math.min(100, b.averagePercent))}%` }}>
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-bold whitespace-nowrap text-slate-700 tabular-nums">{b.averagePercent}%</span>
                    </div>
                  </div>
                  <span className="mt-2 line-clamp-2 text-center text-[11px] font-semibold text-slate-700">{b.batch.name}</span>
                  <span className="line-clamp-1 text-center text-[10px] text-slate-400">{b.test.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  )
}
