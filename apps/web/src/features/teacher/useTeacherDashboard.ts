import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Structure } from '@/features/academic/api'
import type { AcademicFilters } from '@/features/academic/filters'
import type { Me } from '@/features/auth/types'
import type { MouStatus } from '@/features/admin/useDashboard'
import type { Announcement } from '@/features/portal/Announcements'
import type { SpecialClassType } from '@/features/schedule/api'

export type TeacherDashboard = {
  school: {
    id: string
    name: string
    board: string
    classes: string[]
    academicYearStartMonth: number
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
  /** `id` is the class key the attendance page takes ("slot:…" or "special:…"). */
  todaySchedule: {
    id: string
    time: string
    className: string
    type: SpecialClassType | null
    subject: string | null
    batch: string
    room: string | null
  }[]
  adminFeedback: { id: string; message: string; createdAt: string }[]
}

export const teacherDashboardQueryKey = ['teacher-dashboard'] as const

/** `fresh`: fetch again whenever the caller mounts (the dashboard page, so today's classes are current). */
export function useTeacherDashboard(fresh = false) {
  return useQuery({
    queryKey: teacherDashboardQueryKey,
    queryFn: () => api<TeacherDashboard>('/teacher/dashboard'),
    ...(fresh && { refetchOnMount: 'always' as const }),
  })
}

export type TeacherContext = {
  me: Me
  dashboard: TeacherDashboard | undefined
  dashboardError: Error | null
  /** The teacher's assigned programs and batches. */
  structure: Structure | undefined
  /** Set when the teacher's programs and batches couldn't be loaded. */
  structureError: Error | null
  filters: AcademicFilters
  /** Opens the Switch / Join School dialog. */
  openSwitchSchool: () => void
}

export const useTeacherContext = () => useOutletContext<TeacherContext>()
