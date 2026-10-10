import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Me } from '@/features/auth/types'
import type { MouStatus } from '@/features/admin/useDashboard'
import type { Announcement } from '@/features/portal/Announcements'

export type TeacherDashboard = {
  school: {
    id: string
    name: string
    board: string
    classes: string[]
    mouStartDate: string | null
    mouEndDate: string | null
    mouStatus: MouStatus
  } | null
  programs: { id: string; name: string }[]
  announcements: Announcement[]
  stats: {
    todayClasses: number
    pendingDailyReports: number
    assignmentsToGrade: number
    upcomingTests: number
  }
  todaySchedule: { id: string; time: string; className: string; batch: string; room: string }[]
  adminFeedback: { id: string; message: string; createdAt: string }[]
}

export const teacherDashboardQueryKey = ['teacher-dashboard'] as const

export function useTeacherDashboard() {
  return useQuery({
    queryKey: teacherDashboardQueryKey,
    queryFn: () => api<TeacherDashboard>('/teacher/dashboard'),
  })
}

export type TeacherContext = {
  me: Me
  dashboard: TeacherDashboard | undefined
  dashboardError: Error | null
  programId: string
  /** Opens the Switch / Join School dialog. */
  openSwitchSchool: () => void
}

export const useTeacherContext = () => useOutletContext<TeacherContext>()
