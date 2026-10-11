import { useOutletContext } from 'react-router-dom'
import type { Structure } from '@/features/academic/api'
import type { AcademicFilters } from '@/features/academic/filters'
import type { Me } from '@/features/auth/types'
import type { Dashboard } from './useDashboard'

export type AdminContext = {
  me: Me
  schoolId: string
  dashboard: Dashboard | undefined
  dashboardError: Error | null
  /** Programs and batches of the school, for pickers. */
  structure: Structure | undefined
  /** The sidebar Program → Batch filters. */
  filters: AcademicFilters
}

export const useAdminContext = () => useOutletContext<AdminContext>()
