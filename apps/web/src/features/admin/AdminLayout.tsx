import { useState } from 'react'
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Building2, GraduationCap, HelpCircle, LogOut, Menu, Settings, Users, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Select } from '@/components/ui/Select'
import { meQueryKey, useLogout, useMe } from '@/features/auth/session'
import { adminSchools, type Me } from '@/features/auth/types'
import { adminNav } from './nav'
import type { AdminContext } from './adminContext'
import { useDashboard } from './useDashboard'

const ALL_PROGRAMS = 'all'

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
  const logout = useLogout()
  const { data: dashboard, error: dashboardError } = useDashboard(schoolId)
  const [programId, setProgramId] = useState(ALL_PROGRAMS)
  const [navOpen, setNavOpen] = useState(false)
  const initial = me.fullName.trim().charAt(0).toUpperCase()

  async function switchSchool(id: string) {
    if (id === schoolId) return
    await api('/auth/active-school', { method: 'POST', body: JSON.stringify({ schoolId: id }) })
    queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, activeSchoolId: id } : old))
    navigate('/dashboard')
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 pt-5 pb-6">
        <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-sm font-semibold text-white">
          {initial}
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">EduAdmin Pro</p>
          <p className="text-xs text-slate-500">School Management</p>
        </div>
        <button
          type="button"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
          className="ml-auto rounded p-1 text-slate-400 hover:text-slate-700 lg:hidden"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="space-y-3 px-4">
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
        <Select
          size="sm"
          aria-label="Program"
          icon={GraduationCap}
          iconClassName="text-fuchsia-500"
          value={programId}
          options={[
            { value: ALL_PROGRAMS, label: 'All Programs' },
            ...(dashboard?.programs ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
          onChange={setProgramId}
        />
        <Select
          size="sm"
          aria-label="Batch"
          icon={Users}
          iconClassName="text-emerald-600"
          value={null}
          options={[]}
          onChange={() => {}}
          placeholder="No batches yet"
          disabled
        />
      </div>

      <nav className="mt-6 flex-1 space-y-0.5 overflow-y-auto px-4 pb-4">
        {adminNav.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path ? `/dashboard/${path}` : '/dashboard'}
            end={!path}
            onClick={() => setNavOpen(false)}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition ${
                isActive
                  ? 'bg-slate-100 font-semibold text-slate-900 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-ink'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 px-6 py-5">
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-3 text-sm text-slate-600 hover:text-slate-900"
        >
          <LogOut className="size-4" /> Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => setNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-2 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-4 sm:gap-5">
            {[
              { icon: HelpCircle, label: 'Help' },
              { icon: Bell, label: 'Notifications' },
              { icon: Settings, label: 'Settings' },
            ].map(({ icon: Icon, label }) => (
              <button key={label} type="button" aria-label={label} title={label} className="text-slate-500 hover:text-slate-800">
                <Icon className="size-5" />
              </button>
            ))}
            <span
              className="flex size-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white"
              title={`${me.fullName} (${me.email})`}
            >
              {initial}
            </span>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:py-8">
          <Outlet
            context={{ me, schoolId, dashboard, dashboardError, programId } satisfies AdminContext}
          />
        </main>
      </div>
    </div>
  )
}
