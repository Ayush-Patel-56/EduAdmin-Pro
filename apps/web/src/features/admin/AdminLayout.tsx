import { useCallback, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Select } from '@/components/ui/Select'
import { meQueryKey, useMe } from '@/features/auth/session'
import { adminSchools, type Me } from '@/features/auth/types'
import { PortalShell } from '@/features/portal/PortalShell'
import { searchStudents } from '@/features/students/api'
import { useStructure } from '@/features/academic/api'
import { useAcademicFilters } from '@/features/academic/filters'
import { BatchSelect, ProgramSelect } from '@/features/portal/Selectors'
import { adminExtraSections, adminNav } from './nav'
import type { AdminContext } from './adminContext'
import { AdminProfileMenu } from './AdminProfileMenu'
import { useDashboard } from './useDashboard'

// Schools, programs and batches are all managed under Academic Planning.
const PLANNING = '/management/academic-planning'

export function AdminLayout() {
  const { data: me } = useMe()
  if (!me) return null
  const schools = adminSchools(me)
  const schoolId = schools.find((s) => s.schoolId === me.activeSchoolId)?.schoolId ?? schools[0]?.schoolId
  if (!schoolId) return <Navigate to="/onboarding" replace />
  // Keyed so per-school UI state (selected program, open menus) resets on switch.
  return <AdminShell key={schoolId} me={me} schoolId={schoolId} />
}

function AdminShell({ me, schoolId }: { me: Me; schoolId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: dashboard, error: dashboardError } = useDashboard(schoolId)
  const { data: structure } = useStructure({ kind: 'admin', schoolId })
  const filters = useAcademicFilters(structure, `filters:${schoolId}`)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const schools = adminSchools(me)
  const schoolName = schools.find((s) => s.schoolId === schoolId)?.schoolName ?? null
  const searchRemote = useCallback((q: string) => searchStudents({ kind: 'admin', schoolId }, q), [schoolId])

  async function switchSchool(id: string) {
    if (id === schoolId) return
    setSwitchError(null)
    try {
      await api('/auth/active-school', { method: 'POST', body: JSON.stringify({ schoolId: id }) })
    } catch (err) {
      // Stay on the current school and say why, instead of leaving an unhandled rejection.
      setSwitchError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      return
    }
    // Nothing cached for the school we're leaving should outlive the switch.
    queryClient.removeQueries({ predicate: (q) => q.queryKey.includes(schoolId) })
    queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, activeSchoolId: id } : old))
    navigate('/management')
  }

  return (
    <PortalShell
      me={me}
      subtitle="School Management"
      roleLabel="Admin"
      defaultAccent="INDIGO"
      basePath="/management"
      nav={adminNav}
      extraPages={adminExtraSections}
      avatarClassName="bg-emerald-600"
      searchRemote={searchRemote}
      renderProfileMenu={({ close, openPreferences, openProfilePicture }) => (
        <AdminProfileMenu
          me={me}
          schoolName={schoolName}
          manageSchoolsTo={`${PLANNING}?tab=schools`}
          onPreferences={openPreferences}
          onProfilePicture={openProfilePicture}
          onClose={close}
        />
      )}
      selectors={
        <>
          <Select
            size="sm"
            aria-label="School"
            icon={Building2}
            iconClassName="text-indigo-500"
            value={schoolId}
            options={schools.map((s) => ({ value: s.schoolId, label: s.schoolName }))}
            onChange={switchSchool}
            footer={[
              { label: 'Manage Schools', onSelect: () => navigate(`${PLANNING}?tab=schools`) },
              { label: '+ Create new school', onSelect: () => navigate('/onboarding/create') },
              { label: '# Join another school', onSelect: () => navigate('/onboarding/join') },
            ]}
          />
          <ProgramSelect
            programs={structure?.programs ?? []}
            value={filters.programId}
            onChange={filters.setProgramId}
            footer={[{ label: 'Manage Programs', onSelect: () => navigate(`${PLANNING}?tab=programs`) }]}
          />
          <BatchSelect
            batches={filters.batchOptions}
            value={filters.batchId}
            onChange={filters.setBatchId}
            footer={[{ label: 'Manage Batches', onSelect: () => navigate(`${PLANNING}?tab=batches`) }]}
          />
        </>
      }
    >
      {switchError && (
        <p role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Couldn’t switch school: {switchError}</span>
          <button type="button" onClick={() => setSwitchError(null)} aria-label="Dismiss" className="font-semibold">
            ×
          </button>
        </p>
      )}
      <Outlet context={{ me, schoolId, dashboard, dashboardError, structure, filters } satisfies AdminContext} />
    </PortalShell>
  )
}
