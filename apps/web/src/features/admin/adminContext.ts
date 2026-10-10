import { useOutletContext } from 'react-router-dom'
import type { Me } from '@/features/auth/types'
import type { Dashboard } from './useDashboard'

export type AdminContext = {
  me: Me
  schoolId: string
  dashboard: Dashboard | undefined
  dashboardError: Error | null
  programId: string
}

export const useAdminContext = () => useOutletContext<AdminContext>()
