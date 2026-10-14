import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { SpecialClassType } from '@/features/schedule/api'

export type MouStatus = 'NOT_SET' | 'UPCOMING' | 'ACTIVE' | 'EXPIRED'

export type Dashboard = {
  school: {
    id: string
    name: string
    inviteCode: string
    adminInviteCode: string
    board: string
    classes: string[]
    classesLabel: string
    mouStartDate: string | null
    mouEndDate: string | null
    mouStatus: MouStatus
  }
  programs: { id: string; name: string }[]
  announcements: { id: string; category: string; title: string; createdAt: string }[]
  todaySchedule: {
    id: string
    time: string
    className: string
    /** Set for a special class (Extra, Doubt, …); null for a weekly slot. */
    type: SpecialClassType | null
    batch: string
    teacher: string
    room: string
  }[]
}

export const dashboardQueryKey = (schoolId: string) => ['dashboard', schoolId] as const

/** `fresh`: fetch again whenever the caller mounts (the dashboard page, so today's classes are current). */
export function useDashboard(schoolId: string, fresh = false) {
  return useQuery({
    queryKey: dashboardQueryKey(schoolId),
    queryFn: () => api<Dashboard>(`/schools/${schoolId}/dashboard`),
    ...(fresh && { refetchOnMount: 'always' as const }),
  })
}
