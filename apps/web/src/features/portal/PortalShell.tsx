import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { HelpCircle, LogOut, Menu, Settings, X, type LucideIcon } from 'lucide-react'
import { useDismiss } from '@/components/ui/useDismiss'
import { useLogout } from '@/features/auth/session'
import { preferencesOf, type AccentTheme, type Me } from '@/features/auth/types'
import { GlobalSearch, type RemoteSearch, type SearchItem } from './GlobalSearch'
import { HelpCenterDialog } from './HelpCenterDialog'
import { Avatar } from './Avatar'
import { NotificationsMenu } from './NotificationsMenu'
import { PreferencesDialog } from './PreferencesDialog'
import { ProfilePictureDialog } from './ProfilePictureDialog'

export type NavItem = { path: string; label: string; icon: LucideIcon }

export type ProfileMenuActions = {
  close: () => void
  openPreferences: () => void
  openProfilePicture: () => void
}

type PortalShellProps = {
  me: Me
  /** Under "EduAdmin Pro", e.g. "School Management" or "Faculty Portal". */
  subtitle: string
  /** Shown on the profile card, e.g. "Admin" or "Teacher". */
  roleLabel: string
  /** Accent used until the user picks one in Account Preferences. */
  defaultAccent: AccentTheme
  /** Base route; nav item paths are relative to it ('' is the home page). */
  basePath: string
  nav: NavItem[]
  /** Pages that are searchable but not in the sidebar. */
  extraPages?: { path: string; label: string }[]
  /** School / program / batch pickers above the navigation. */
  selectors: ReactNode
  avatarClassName: string
  /** Finds records (e.g. students) for the header search. */
  searchRemote?: RemoteSearch
  /** The menu that opens under the avatar. */
  renderProfileMenu: (actions: ProfileMenuActions) => ReactNode
  children: ReactNode
}

type Dialog = 'help' | 'preferences' | 'picture' | null

/** Sidebar + top bar layout shared by the admin dashboard and the faculty portal. */
export function PortalShell({
  me,
  subtitle,
  roleLabel,
  defaultAccent,
  basePath,
  nav,
  extraPages = [],
  selectors,
  avatarClassName,
  searchRemote,
  renderProfileMenu,
  children,
}: PortalShellProps) {
  const logout = useLogout()
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeDialog = useCallback(() => setDialog(null), [])
  const openPreferences = useCallback(() => setDialog('preferences'), [])
  const openProfilePicture = useCallback(() => setDialog('picture'), [])
  useDismiss(menuRef, menuOpen, closeMenu)
  const initial = me.fullName.trim().charAt(0).toUpperCase()
  const accent = (preferencesOf(me).accentTheme ?? defaultAccent).toLowerCase()
  // On <html> as well, so menus and pickers rendered outside the shell (portals) follow the theme.
  useEffect(() => {
    document.documentElement.dataset.accent = accent
    return () => {
      delete document.documentElement.dataset.accent
    }
  }, [accent])

  const searchItems = useMemo<SearchItem[]>(
    () =>
      [...nav, ...extraPages].map((p) => ({
        label: p.label,
        to: p.path ? `${basePath}/${p.path}` : basePath,
        group: 'Pages',
      })),
    [nav, extraPages, basePath],
  )

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
                  ? 'bg-brand-50 font-semibold text-slate-900 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-600'
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
    <div data-accent={accent} className="min-h-screen bg-slate-50">
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
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <div className="hidden min-w-0 flex-1 sm:block">
            <GlobalSearch items={searchItems} remote={searchRemote} />
          </div>
          <div className="ml-auto flex items-center gap-4 sm:gap-5">
            <HeaderButton icon={HelpCircle} label="Help Center" onClick={() => setDialog('help')} />
            <NotificationsMenu />
            <HeaderButton icon={Settings} label="Account Preferences" onClick={openPreferences} />
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                className="flex size-9 items-center justify-center rounded-full ring-offset-2 transition hover:ring-2 hover:ring-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:outline-none"
              >
                <Avatar me={me} className={`size-9 rounded-full text-sm ${avatarClassName}`} />
              </button>
              {menuOpen && renderProfileMenu({ close: closeMenu, openPreferences, openProfilePicture })}
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>

      {dialog === 'help' && <HelpCenterDialog onClose={closeDialog} />}
      {dialog === 'preferences' && (
        <PreferencesDialog me={me} defaultAccent={defaultAccent} roleLabel={roleLabel} onClose={closeDialog} />
      )}
      {dialog === 'picture' && <ProfilePictureDialog me={me} onClose={closeDialog} />}
    </div>
  )
}

function HeaderButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="text-slate-500 hover:text-slate-800">
      <Icon className="size-5" />
    </button>
  )
}
