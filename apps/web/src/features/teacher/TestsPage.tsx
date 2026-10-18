import { useSearchParams } from 'react-router-dom'
import { FileQuestion, ListChecks } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { assessmentsBase, useAssessmentOptions } from '@/features/assessments/api'
import { QuestionBank } from '@/features/assessments/QuestionBank'
import { TestsTable } from '@/features/assessments/TestsTable'
import { TestWorkspace } from '@/features/assessments/TestWorkspace'
import { Spinner, Tabs } from '@/features/assessments/ui'
import { useTeacherContext } from './useTeacherDashboard'

type Tab = 'questions' | 'tests'
const TABS: { key: Tab; label: string; icon: typeof ListChecks }[] = [
  { key: 'questions', label: 'My Question Bank', icon: FileQuestion },
  { key: 'tests', label: 'Tests', icon: ListChecks },
]
const base = assessmentsBase()

/** Tests & Question Bank (PRD 5.11): the teacher's questions, and the tests of their batches with papers and results. */
export function TestsPage() {
  const { dashboard } = useTeacherContext()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'tests' || params.get('test') ? 'tests' : 'questions'
  const testId = params.get('test')
  const options = useAssessmentOptions(base)

  return (
    <>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Tests &amp; Question Bank</h1>
        <p className="mt-1 text-sm text-slate-500">Build your question bank, schedule tests for your batches and enter results</p>
      </div>
      {options.error && (
        <div className="mt-4">
          <ErrorBanner message={options.error.message} />
        </div>
      )}
      {options.data && !options.data.active && <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">Your faculty profile is inactive, so this page is read-only.</p>}
      <div className="mt-6">
        {testId && options.data ? (
          <TestWorkspace base={base} testId={testId} options={options.data} institute={dashboard?.school?.name ?? ''} onBack={() => setParams({ tab: 'tests' })} />
        ) : (
          <>
            <Tabs label="Tests and question bank" tabs={TABS} value={tab} onChange={(t) => setParams(t === 'questions' ? {} : { tab: t })} />
            <div className="mt-5">
              {!options.data ? (
                <Spinner />
              ) : tab === 'questions' ? (
                <QuestionBank base={base} options={options.data} variant="faculty" />
              ) : (
                <TestsTable base={base} options={options.data} variant="faculty" facultyId={options.data.facultyId} onOpen={(id) => setParams({ tab: 'tests', test: id })} />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
