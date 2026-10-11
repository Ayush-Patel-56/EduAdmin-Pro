import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CircleCheck,
  ClipboardList,
  Loader2,
  MessageSquareText,
  Plus,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { firstName } from '@/features/auth/types'
import type { MouStatus } from '@/features/admin/useDashboard'
import { AnnouncementList } from '@/features/portal/Announcements'
import { formatDate, formatLongDate } from '@/features/portal/format'
import { useTeacherContext, type TeacherDashboard } from './useTeacherDashboard'

export function TeacherDashboardPage() {
  const { me, dashboard, dashboardError, openSwitchSchool } = useTeacherContext()
  const [today] = useState(() => new Date())

  if (dashboardError) {
    return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{dashboardError.message}</p>
  }
  if (!dashboard) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-slate-400" aria-label="Loading" />
      </div>
    )
  }

  const { stats } = dashboard
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Welcome back, {firstName(me)}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatLongDate(today)} • You have {stats.todayClasses} class{stats.todayClasses === 1 ? '' : 'es'} today
          </p>
        </div>
        <Link
          to="/teacher/daily-report"
          className="flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink-hover"
        >
          <Plus className="size-4" /> Add Class Note
        </Link>
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-3">
        <Institution school={dashboard.school} onJoin={openSwitchSchool} />
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-slate-900">
            <Bell className="size-5 text-slate-700" /> Announcements
          </h2>
          <AnnouncementList items={dashboard.announcements} />
        </section>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat dark icon={Calendar} value={stats.todayClasses} label="Today's Classes" />
        <Stat
          icon={TriangleAlert}
          iconClass="bg-amber-50 text-amber-500"
          className="border-l-4 border-l-amber-400"
          value={stats.pendingDailyReports}
          label="Pending Daily Reports"
        />
        <Stat icon={CircleCheck} iconClass="bg-blue-50 text-blue-600" value={stats.assignmentsToGrade} label="Assignments to Grade" />
        <Stat icon={ClipboardList} iconClass="bg-purple-50 text-purple-600" value={stats.upcomingTests} label="Upcoming Tests" />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Today's Schedule</h2>
            <Link to="/teacher/schedule" className="text-sm font-bold text-slate-900 hover:text-brand-600">
              View Full Week
            </Link>
          </div>
          <TodaySchedule rows={dashboard.todaySchedule} />
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-base font-bold text-slate-900">Quick Actions</h2>
            <div className="space-y-3">
              <QuickAction to="/teacher/daily-report" icon={ClipboardList} iconClass="text-slate-700" label="Submit Daily Report" />
              <QuickAction to="/teacher/courses" icon={BookOpen} iconClass="text-emerald-600" label="Upload Material" />
              <QuickAction to="/teacher/assignments" icon={Plus} iconClass="text-amber-500" label="Create Assignment" />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <MessageSquareText className="size-5 text-purple-500" /> Feedback from Admin
              </h2>
              <Link to="/teacher/feedback" className="text-xs font-bold text-slate-900 hover:text-brand-600">
                View All
              </Link>
            </div>
            {dashboard.adminFeedback.length === 0 ? (
              <p className="mt-4 text-xs text-slate-400 italic">No feedback from management yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {dashboard.adminFeedback.map((f) => (
                  <li key={f.id} className="rounded-lg border border-slate-100 p-2.5 text-xs text-slate-700">
                    {f.message}
                    <time className="mt-1 block text-[10px] text-slate-400">{formatDate(f.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

const mouLabel: Record<MouStatus, { text: string; className: string }> = {
  ACTIVE: { text: 'Active', className: 'text-emerald-600' },
  UPCOMING: { text: 'Upcoming', className: 'text-sky-600' },
  EXPIRED: { text: 'Expired', className: 'text-amber-600' },
  NOT_SET: { text: 'Not set', className: 'text-slate-900' },
}

/** "6th".."12th" → "6".."12"; anything else (e.g. "12th Pass") is kept as is. */
const shortClass = (c: string) => c.match(/^(\d+)(st|nd|rd|th)$/)?.[1] ?? c

function Institution({ school, onJoin }: { school: TeacherDashboard['school']; onJoin: () => void }) {
  const mou = mouLabel[school?.mouStatus ?? 'NOT_SET']
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-slate-300 bg-slate-200/50 p-6 sm:flex-row sm:items-center xl:col-span-2">
      <div className="flex flex-1 items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
          <Building2 className="size-5" />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">Institution Information</p>
          <p className="text-sm font-bold text-slate-900">{school?.name ?? 'Not set'}</p>
          {!school && (
            <button type="button" onClick={onJoin} className="text-xs font-medium text-brand-600 hover:underline">
              Join your school with its code
            </button>
          )}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <Fact label="Board">{school?.board ?? 'Not set'}</Fact>
        <Fact label="Active Classes">{school ? school.classes.map(shortClass).join(', ') : 'Not set'}</Fact>
        <Fact label="MOU Status">
          <span className={mou.className}>{mou.text}</span>
        </Fact>
      </dl>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{children}</dd>
    </div>
  )
}

type StatProps = {
  icon: LucideIcon
  value: number
  label: string
  dark?: boolean
  iconClass?: string
  className?: string
}

function Stat({ icon: Icon, value, label, dark, iconClass = '', className = '' }: StatProps) {
  return (
    <div
      className={`rounded-xl p-5 ${
        dark ? 'bg-linear-to-br from-[#0b1427] to-[#1a2438] text-white' : 'border border-slate-200 bg-white'
      } ${className}`}
    >
      <span className={`flex size-8 items-center justify-center rounded-lg ${dark ? 'bg-white/10' : iconClass}`}>
        <Icon className="size-4" />
      </span>
      <p className={`mt-4 text-3xl font-bold ${dark ? '' : 'text-slate-900'}`}>{value}</p>
      <p className={`mt-0.5 text-sm font-semibold ${dark ? 'text-white/85' : 'text-slate-600'}`}>{label}</p>
    </div>
  )
}

function TodaySchedule({ rows }: { rows: TeacherDashboard['todaySchedule'] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-4 ml-5 border-l-2 border-slate-200 py-1 pl-8 text-sm text-slate-400 italic">
        No classes scheduled today.
      </p>
    )
  }
  return (
    <ol className="mt-4 ml-5 space-y-3 border-l-2 border-slate-200 pl-8">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-900">
            {r.time} · {r.className}
          </p>
          <p className="text-xs text-slate-500">
            {r.batch} · Room {r.room}
          </p>
        </li>
      ))}
    </ol>
  )
}

function QuickAction({ to, icon: Icon, iconClass, label }: { to: string; icon: LucideIcon; iconClass: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:bg-slate-50"
    >
      <span className={`flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white ${iconClass}`}>
        <Icon className="size-4" />
      </span>
      <span className="text-sm font-semibold text-slate-900">{label}</span>
    </Link>
  )
}
