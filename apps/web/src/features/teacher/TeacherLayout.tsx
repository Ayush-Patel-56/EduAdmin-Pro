import { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useMe } from '@/features/auth/session'
import { PortalShell } from '@/features/portal/PortalShell'
import { useStructure } from '@/features/academic/api'
import { useAcademicFilters } from '@/features/academic/filters'
import { BatchSelect, ProgramSelect } from '@/features/portal/Selectors'
import { teacherExtraSections, teacherNav } from './nav'
import { ProfileMenu } from './ProfileMenu'
import { SwitchSchoolDialog } from './SwitchSchoolDialog'
import { useTeacherDashboard, type TeacherContext } from './useTeacherDashboard'

export function TeacherLayout() {
  const { data: me } = useMe()
  const { data: dashboard, error: dashboardError } = useTeacherDashboard()
  const schoolId = dashboard?.school?.id ?? null
  // Only fetched once the teacher is in a school; the API answers 403 otherwise.
  const { data: structure } = useStructure({ kind: 'teacher' }, !!schoolId)
  const filters = useAcademicFilters(structure, `filters:teacher:${schoolId ?? 'none'}`)
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
          <ProgramSelect programs={structure?.programs ?? []} value={filters.programId} onChange={filters.setProgramId} />
          <BatchSelect batches={filters.batchOptions} value={filters.batchId} onChange={filters.setBatchId} />
        </>
      }
    >
      <Outlet context={{ me, dashboard, dashboardError, structure, filters, openSwitchSchool } satisfies TeacherContext} />
      {switchOpen && <SwitchSchoolDialog currentSchool={schoolName} onClose={closeSwitchSchool} />}
    </PortalShell>
  )
}
