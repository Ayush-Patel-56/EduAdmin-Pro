import { Link } from 'react-router-dom'
import { Building2, LogIn, User } from 'lucide-react'
import type { Me } from '@/features/auth/types'

type ProfileMenuProps = {
  me: Me
  schoolName: string | null
  onSwitchSchool: () => void
  onClose: () => void
}

/** Dropdown under the teacher's avatar: who they are, their school, and switching it. */
export function ProfileMenu({ me, schoolName, onSwitchSchool, onClose }: ProfileMenuProps) {
  const initial = me.fullName.trim().charAt(0).toUpperCase()
  return (
    <div
      role="menu"
      className="absolute top-full right-0 z-40 mt-3 w-[min(240px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.25)]"
    >
      <div className="flex items-start gap-3 bg-slate-50 px-4 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{me.fullName}</p>
          <p className="truncate text-[11px] text-slate-500">{me.email}</p>
          <span className="mt-1.5 inline-block rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink uppercase">
            {me.accountType === 'TEACHER' ? 'Teacher' : 'Admin'}
          </span>
        </div>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Current school</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-800">
          <Building2 className="size-4 shrink-0 text-slate-400" />
          <span className="truncate">{schoolName ?? 'Not connected'}</span>
        </p>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            onSwitchSchool()
          }}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#eef4ff] text-xs font-semibold text-ink transition hover:bg-[#e3ecff]"
        >
          <LogIn className="size-3.5" /> {schoolName ? 'Switch School' : 'Join School'}
        </button>
        <Link
          to="/teacher/profile"
          role="menuitem"
          onClick={onClose}
          className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
        >
          <User className="size-3.5" /> My Profile
        </Link>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full border-t border-slate-100 py-3 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      >
        Close
      </button>
    </div>
  )
}
