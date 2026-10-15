import { useNavigate } from 'react-router-dom'
import { MyProfileDialog } from './MyProfile'
import { useTeacherContext } from './useTeacherDashboard'

/** /teacher/profile (a direct link): shows My Profile and returns to the portal home when closed. */
export function MyProfilePage() {
  const { dashboard } = useTeacherContext()
  const navigate = useNavigate()
  return <MyProfileDialog schoolId={dashboard?.school?.id ?? null} onClose={() => navigate('/teacher')} />
}
