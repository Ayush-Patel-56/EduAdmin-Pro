import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
    batch: string
    teacher: string
    room: string
  }[]
}

export const dashboardQueryKey = (schoolId: string) => ['dashboard', schoolId] as const

export function useDashboard(schoolId: string) {
  return useQuery({
    queryKey: dashboardQueryKey(schoolId),
    queryFn: () => api<Dashboard>(`/schools/${schoolId}/dashboard`),
  })
}
