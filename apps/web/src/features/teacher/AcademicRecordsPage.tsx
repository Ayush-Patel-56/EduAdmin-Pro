import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, Search } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { Select } from '@/components/ui/Select'
import { formatDay } from '@/features/portal/format'
import { assessmentsBase, PHASE_LABELS, useAssessmentOptions, useGradableTests } from '@/features/assessments/api'
import { ResultsSheet } from '@/features/assessments/ResultsSheet'
import { Card, Empty, InactiveNotice, Spinner } from '@/features/assessments/ui'

const base = assessmentsBase()

/** Academic Records, "Test Results Entry" (PRD 5.12): pick a test of your batches and enter its results. */
export function AcademicRecordsPage() {
  const [params, setParams] = useSearchParams()
  const options = useAssessmentOptions(base)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const gradable = useGradableTests(base, q)
  const started = gradable.tests
  // A test opened from a link stays selected even if it isn't among those loaded yet.
  const selected = params.get('test') ?? started[0]?.id ?? null

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Academic Records</h1>
          <p className="mt-1 text-sm text-slate-500">Test Results Entry: mark attendance and enter results; ranks and percentiles follow</p>
        </div>
        {(started.length > 0 || q) && (
          <div className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:w-[36rem]">
            <div>
              <label htmlFor="assessment-search" className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Find a Test
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="assessment-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title, subject or batch"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label htmlFor="assessment" className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Select Assessment
              </label>
              <Select
                id="assessment"
                icon={ClipboardList}
                value={selected}
                placeholder={started.length ? 'Select a test' : 'No tests match'}
                options={started.map((t) => ({ value: t.id, label: `${t.title} · ${t.batch.name} · ${formatDay(t.date)}${t.phase === 'ONGOING' ? ` (${PHASE_LABELS.ONGOING})` : ''}` }))}
                onChange={(id) => setParams({ test: id }, { replace: true })}
                footer={gradable.remaining > 0 ? [{ label: gradable.loadingMore ? 'Loading…' : `Load ${Math.min(50, gradable.remaining)} more (${gradable.remaining} older)`, onSelect: () => void gradable.loadMore() }] : undefined}
              />
            </div>
          </div>
        )}
      </div>
      {gradable.error && (
        <div className="mt-4">
          <ErrorBanner message={gradable.error.message} />
        </div>
      )}
      <div className="mt-6">
        {options.data && !options.data.active ? (
          <InactiveNotice />
        ) : !gradable.loaded && !gradable.error ? (
          <Spinner />
        ) : !selected ? (
          <Card>
            <Empty>{q ? `No started tests match “${q}”.` : 'No tests to grade yet. Tests of your batches show here once they start; schedule one under Tests & Question Bank.'}</Empty>
          </Card>
        ) : (
          <ResultsSheet base={base} testId={selected} />
        )}
      </div>
    </>
  )
}
