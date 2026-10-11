import { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useMe } from '@/features/auth/session'
import { PortalShell } from '@/features/portal/PortalShell'
import { ALL_PROGRAMS, BatchSelect, ProgramSelect } from '@/features/portal/Selectors'
import { teacherExtraSections, teacherNav } from './nav'
import { ProfileMenu } from './ProfileMenu'
import { SwitchSchoolDialog } from './SwitchSchoolDialog'
import { useTeacherDashboard, type TeacherContext } from './useTeacherDashboard'

export function TeacherLayout() {
  const { data: me } = useMe()
  const { data: dashboard, error: dashboardError } = useTeacherDashboard()
  const [programId, setProgramId] = useState(ALL_PROGRAMS)
  const [switchOpen, setSwitchOpen] = useState(false)
  const openSwitchSchool = useCallback(() => setSwitchOpen(true), [])
  const closeSwitchSchool = useCallback(() => setSwitchOpen(false), [])
  if (!me) return null
  const schoolName = dashboard?.school?.name ?? null

  return (
    <PortalShell
      me={me}
      subtitle="Faculty Portal"
      roleLabel="Teacher"
      defaultAccent="BLUE"
      basePath="/teacher"
      nav={teacherNav}
      extraPages={teacherExtraSections}
      avatarClassName="bg-ink"
      renderProfileMenu={({ close, openPreferences }) => (
        <ProfileMenu
          me={me}
          schoolName={schoolName}
          onSwitchSchool={openSwitchSchool}
          onPreferences={openPreferences}
          onClose={close}
        />
      )}
      selectors={
        <>
          <ProgramSelect programs={dashboard?.programs ?? []} value={programId} onChange={setProgramId} />
          <BatchSelect />
        </>
      }
    >
      <Outlet context={{ me, dashboard, dashboardError, programId, openSwitchSchool } satisfies TeacherContext} />
      {switchOpen && <SwitchSchoolDialog currentSchool={schoolName} onClose={closeSwitchSchool} />}
    </PortalShell>
  )
}
