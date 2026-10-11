import { SyllabusTracker } from '@/features/academic/SyllabusTracker'
import { useTeacherContext } from './useTeacherDashboard'

export function TeacherAcademicPlanningPage() {
  const { dashboard, structure, structureError, filters, openSwitchSchool } = useTeacherContext()
  const school = dashboard?.school

  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Academic Planning</h1>
      <p className="mt-1 text-sm text-slate-500">Track syllabus coverage for your assigned batches and subjects.</p>
      <div className="mt-6">
        {structureError && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn’t load your batches: {structureError.message}. Refresh the page to try again.
          </p>
        )}
        {dashboard && !school ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            You’re not connected to a school yet.{' '}
            <button type="button" onClick={openSwitchSchool} className="font-semibold underline">
              Join with your school’s invite code
            </button>
            .
          </p>
        ) : (
          school && (
            <SyllabusTracker source={{ kind: 'teacher' }} structure={structure} filters={filters} schoolName={school.name} />
          )
        )}
      </div>
    </>
  )
}
