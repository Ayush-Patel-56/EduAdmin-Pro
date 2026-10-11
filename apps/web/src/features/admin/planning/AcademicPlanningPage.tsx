import { useSearchParams } from 'react-router-dom'
import { SyllabusTracker } from '@/features/academic/SyllabusTracker'
import { useAdminContext } from '../adminContext'
import { BatchesTab } from './BatchesTab'
import { FacultyTab } from './FacultyTab'
import { ProgramsTab } from './ProgramsTab'
import { PromotionTab } from './PromotionTab'
import { SchoolsTab } from './SchoolsTab'

const TABS = [
  { id: 'schools', label: 'Schools' },
  { id: 'programs', label: 'Programs' },
  { id: 'batches', label: 'Batches' },
  { id: 'syllabus', label: 'Syllabus Tracker' },
  { id: 'faculty', label: 'Faculty' },
  { id: 'promotion', label: 'Promotion' },
] as const

type TabId = (typeof TABS)[number]['id']

export function AcademicPlanningPage() {
  const { me, schoolId, structure, filters } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'schools'
  const schoolName = me.memberships.find((m) => m.schoolId === schoolId)?.schoolName ?? ''

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Academic Planning</h1>
      <p className="mt-1 text-sm text-slate-500">Manage programs, batches, subjects, and syllabus coverage across the institution</p>

      <div role="tablist" aria-label="Academic planning sections" className="mt-6 flex gap-6 overflow-x-auto overflow-y-hidden border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={`-mb-px shrink-0 border-b-2 pb-3 text-sm font-semibold transition ${
              tab === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-6">
        {tab === 'schools' && <SchoolsTab />}
        {tab === 'programs' && <ProgramsTab />}
        {tab === 'batches' && <BatchesTab />}
        {tab === 'syllabus' && (
          <SyllabusTracker
            source={{ kind: 'admin', schoolId }}
            structure={structure}
            filters={filters}
            schoolName={schoolName}
            manageBatchesTo="?tab=batches"
          />
        )}
        {tab === 'faculty' && <FacultyTab />}
        {tab === 'promotion' && <PromotionTab />}
      </div>
    </>
  )
}
