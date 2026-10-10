import { useCallback, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Bell, HelpCircle, LogOut, Menu, Settings, X, type LucideIcon } from 'lucide-react'
import { useDismiss } from '@/components/ui/useDismiss'
import { useLogout } from '@/features/auth/session'
import type { Me } from '@/features/auth/types'

export type NavItem = { path: string; label: string; icon: LucideIcon }

type PortalShellProps = {
  me: Me
  /** Under "EduAdmin Pro", e.g. "School Management" or "Faculty Portal". */
  subtitle: string
  /** Base route; nav item paths are relative to it ('' is the home page). */
  basePath: string
  nav: NavItem[]
  /** School / program / batch pickers above the navigation. */
  selectors: ReactNode
  avatarClassName: string
  /** When given, the avatar opens this menu (rendered below it). */
  renderProfileMenu?: (close: () => void) => ReactNode
  children: ReactNode
}

/** Sidebar + top bar layout shared by the admin dashboard and the faculty portal. */
export function PortalShell({
  me,
  subtitle,
  basePath,
  nav,
  selectors,
  avatarClassName,
  renderProfileMenu,
  children,
}: PortalShellProps) {
  const logout = useLogout()
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuRef, menuOpen, closeMenu)
  const initial = me.fullName.trim().charAt(0).toUpperCase()

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-6 pt-5 pb-6">
        <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-sm font-semibold text-white">
          {initial}
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">EduAdmin Pro</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
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

      <div className="space-y-3 px-4">{selectors}</div>

      <nav className="mt-6 flex-1 space-y-0.5 overflow-y-auto px-4 pb-4">
        {nav.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path ? `${basePath}/${path}` : basePath}
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
            {renderProfileMenu ? (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                  className={`flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white ring-offset-2 transition hover:ring-2 hover:ring-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:outline-none ${avatarClassName}`}
                >
                  {initial}
                </button>
                {menuOpen && renderProfileMenu(closeMenu)}
              </div>
            ) : (
              <span
                className={`flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarClassName}`}
                title={`${me.fullName} (${me.email})`}
              >
                {initial}
              </span>
            )}
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
