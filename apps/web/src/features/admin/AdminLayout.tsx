import { useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Select } from '@/components/ui/Select'
import { meQueryKey, useMe } from '@/features/auth/session'
import { adminSchools, type Me } from '@/features/auth/types'
import { PortalShell } from '@/features/portal/PortalShell'
import { ALL_PROGRAMS, BatchSelect, ProgramSelect } from '@/features/portal/Selectors'
import { adminNav } from './nav'
import type { AdminContext } from './adminContext'
import { useDashboard } from './useDashboard'

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
  const [programId, setProgramId] = useState(ALL_PROGRAMS)

  async function switchSchool(id: string) {
    if (id === schoolId) return
    await api('/auth/active-school', { method: 'POST', body: JSON.stringify({ schoolId: id }) })
    queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, activeSchoolId: id } : old))
    navigate('/dashboard')
  }

  return (
    <PortalShell
      me={me}
      subtitle="School Management"
      basePath="/dashboard"
      nav={adminNav}
      avatarClassName="bg-emerald-600"
      selectors={
        <>
          <Select
            size="sm"
            aria-label="School"
            icon={Building2}
            iconClassName="text-indigo-500"
            value={schoolId}
            options={adminSchools(me).map((s) => ({ value: s.schoolId, label: s.schoolName }))}
            onChange={switchSchool}
            footer={[
              { label: '+ Create new school', onSelect: () => navigate('/onboarding/create') },
              { label: '# Join another school', onSelect: () => navigate('/onboarding/join') },
            ]}
          />
          <ProgramSelect programs={dashboard?.programs ?? []} value={programId} onChange={setProgramId} />
          <BatchSelect />
        </>
      }
    >
      <Outlet context={{ me, schoolId, dashboard, dashboardError, programId } satisfies AdminContext} />
    </PortalShell>
  )
}
