import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useMe } from '@/features/auth/session'
import { PortalShell } from '@/features/portal/PortalShell'
import { ALL_PROGRAMS, BatchSelect, ProgramSelect } from '@/features/portal/Selectors'
import { teacherNav } from './nav'
import { useTeacherDashboard, type TeacherContext } from './useTeacherDashboard'

export function TeacherLayout() {
  const { data: me } = useMe()
  const { data: dashboard, error: dashboardError } = useTeacherDashboard()
  const [programId, setProgramId] = useState(ALL_PROGRAMS)
  if (!me) return null

  return (
    <PortalShell
      me={me}
      subtitle="Faculty Portal"
      basePath="/teacher"
      nav={teacherNav}
      avatarClassName="bg-ink"
      selectors={
        <>
          <ProgramSelect programs={dashboard?.programs ?? []} value={programId} onChange={setProgramId} />
          <BatchSelect />
        </>
      }
    >
      <Outlet context={{ me, dashboard, dashboardError, programId } satisfies TeacherContext} />
    </PortalShell>
  )
}
