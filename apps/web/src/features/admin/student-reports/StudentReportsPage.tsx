import { StudentReportsPage as Reports } from '@/features/student-reports/StudentReportsPage'
import { useAdminContext } from '../adminContext'

/** Student Reports & Analytics for admins (PRD 4.5): every student of the school. */
export function StudentReportsPage() {
  const { schoolId, dashboard } = useAdminContext()
  return <Reports schoolId={schoolId} school={dashboard?.school.name ?? 'School'} />
}
