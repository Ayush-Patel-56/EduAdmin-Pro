import { StudentReportsPage as Reports } from '@/features/student-reports/StudentReportsPage'
import { useTeacherContext } from './useTeacherDashboard'

/** Student Reports for faculty (PRD 5.4): the students of the teacher's own batches. */
export function StudentReportsPage() {
  const { dashboard } = useTeacherContext()
  return <Reports school={dashboard?.school?.name ?? 'School'} />
}
