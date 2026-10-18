import { useSearchParams } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { Select } from '@/components/ui/Select'
import { formatDay } from '@/features/portal/format'
import { assessmentsBase, PHASE_LABELS, useTests } from '@/features/assessments/api'
import { ResultsSheet } from '@/features/assessments/ResultsSheet'
import { Card, Empty, Spinner } from '@/features/assessments/ui'

const base = assessmentsBase()

/** Academic Records, "Test Results Entry" (PRD 5.12): pick a test of your batches and enter its results. */
export function AcademicRecordsPage() {
  const [params, setParams] = useSearchParams()
  // Tests that have started (results can be entered), latest first.
  const tests = useTests(base, { pageSize: 200 })
  const started = (tests.data?.items ?? []).filter((t) => t.phase === 'ONGOING' || t.phase === 'COMPLETED')
  const selected = params.get('test') && started.some((t) => t.id === params.get('test')) ? params.get('test')! : (started[0]?.id ?? null)

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Academic Records</h1>
          <p className="mt-1 text-sm text-slate-500">Test Results Entry: mark attendance and enter results; ranks and percentiles follow</p>
        </div>
        {started.length > 0 && (
          <div className="w-full lg:w-96">
            <label htmlFor="assessment" className="mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Select Assessment
            </label>
            <Select
              id="assessment"
              icon={ClipboardList}
              value={selected}
              options={started.map((t) => ({ value: t.id, label: `${t.title} · ${t.batch.name} · ${formatDay(t.date)}${t.phase === 'ONGOING' ? ` (${PHASE_LABELS.ONGOING})` : ''}` }))}
              onChange={(id) => setParams({ test: id }, { replace: true })}
            />
          </div>
        )}
      </div>
      {tests.error && (
        <div className="mt-4">
          <ErrorBanner message={tests.error.message} />
        </div>
      )}
      <div className="mt-6">
        {!tests.data && !tests.error ? (
          <Spinner />
        ) : !selected ? (
          <Card>
            <Empty>No tests to grade yet. Tests of your batches show here once they start; schedule one under Tests &amp; Question Bank.</Empty>
          </Card>
        ) : (
          <ResultsSheet base={base} testId={selected} />
        )}
      </div>
    </>
  )
}
