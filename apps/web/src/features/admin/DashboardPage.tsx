import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Loader2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { AnnouncementList } from '@/features/portal/Announcements'
import { formatDate } from '@/features/portal/format'
import { useAdminContext } from './adminContext'
import type { Dashboard, MouStatus } from './useDashboard'

const CURRENT_YEAR = new Date().getFullYear()

export function DashboardPage() {
  const { dashboard, dashboardError } = useAdminContext()

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

  const { school } = dashboard
  return (
    <>
      <h1 className="flex flex-wrap items-center gap-x-3 text-2xl font-bold text-slate-900 sm:text-[26px]">
        Institutional Dashboard
        <span className="hidden size-1.5 rounded-full bg-slate-300 sm:block" aria-hidden />
        <span className="text-emerald-600">{school.name}</span>
      </h1>
      <p className="mt-1 text-sm text-slate-500">Overview of academic background and ongoing management tasks</p>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Card icon={Building2} title="School Background" className="md:col-span-2 xl:col-span-7">
          <SchoolBackground dashboard={dashboard} />
        </Card>

        <Card icon={Zap} title="Quick Actions" className="xl:col-span-3">
          <Link
            to="/management/academic-planning"
            className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition hover:bg-slate-50"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Clock className="size-4" />
            </span>
            <span className="flex-1 text-sm font-semibold text-slate-900">Update Macro Plan</span>
            <ChevronRight className="size-4 text-slate-300" />
          </Link>
        </Card>

        <Card icon={Bell} title="Announcements" className="flex flex-col xl:col-span-2">
          <AnnouncementList items={dashboard.announcements} manageTo="/management/announcements" />
        </Card>
      </div>

      <Schedule rows={dashboard.todaySchedule} />
    </>
  )
}

function Card({ icon: Icon, title, className = '', children }: { icon: LucideIcon; title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>
      <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon className="size-5 text-slate-700" /> {title}
      </h2>
      {children}
    </section>
  )
}

function SchoolBackground({ dashboard }: { dashboard: Dashboard }) {
  const { school, programs } = dashboard
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Tile label="Current Board" value={school.board} />
        <Tile label="Active Classes" value={school.classesLabel || 'None'} />
        <Tile label="Programs Offered" value={programs.map((p) => p.name).join(', ') || 'None yet'} />
        <MouTile status={school.mouStatus} start={school.mouStartDate} end={school.mouEndDate} />
      </div>
      <InviteCode
        code={school.inviteCode}
        title="Teacher Invite Code"
        hint="Share with teachers & staff. It joins them as teachers only."
        tone="teacher"
      />
      <InviteCode
        code={school.adminInviteCode}
        title="Admin Invite Code"
        hint="Share only with other administrators. It joins them as admins."
        tone="admin"
      />
    </>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{label}</p>
      <p className="mt-1.5 text-sm font-bold text-slate-900">{value}</p>
    </div>
  )
}

const mouDisplay: Record<MouStatus, { label: (start: string | null, end: string | null) => string; tile: string; heading: string; icon: LucideIcon | null; iconClass: string }> = {
  ACTIVE: {
    label: () => 'Active',
    tile: 'border-indigo-200 bg-indigo-50/40',
    heading: 'text-emerald-600',
    icon: CircleCheck,
    iconClass: 'text-indigo-500',
  },
  UPCOMING: {
    label: (start) => `Starts ${start ? formatDate(start) : ''}`,
    tile: 'border-sky-200 bg-sky-50/40',
    heading: 'text-sky-600',
    icon: Clock,
    iconClass: 'text-sky-500',
  },
  EXPIRED: {
    label: (_, end) => `Expired ${end ? formatDate(end) : ''}`,
    tile: 'border-amber-200 bg-amber-50/50',
    heading: 'text-amber-600',
    icon: CircleAlert,
    iconClass: 'text-amber-500',
  },
  NOT_SET: {
    label: () => 'Not set',
    tile: 'border-slate-200',
    heading: 'text-slate-500',
    icon: null,
    iconClass: '',
  },
}

function MouTile({ status, start, end }: { status: MouStatus; start: string | null; end: string | null }) {
  const d = mouDisplay[status]
  const Icon = d.icon
  const range = start && end ? `${formatDate(start)} – ${formatDate(end)}` : undefined
  return (
    <div className={`flex items-center rounded-lg border p-4 ${d.tile}`} title={range}>
      <div className="flex-1">
        <p className={`text-[10px] font-semibold tracking-wider uppercase ${d.heading}`}>MOU Status</p>
        <p className="mt-1.5 text-sm font-bold text-slate-900">{d.label(start, end)}</p>
      </div>
      {Icon && <Icon className={`size-6 ${d.iconClass}`} />}
    </div>
  )
}

type InviteCodeProps = { code: string; title: string; hint: string; tone: 'teacher' | 'admin' }

const INVITE_TONES = {
  teacher: {
    box: 'border-amber-300 bg-amber-50/70',
    title: 'text-amber-700',
    code: 'text-amber-900',
    hint: 'text-amber-600',
    button: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  },
  admin: {
    box: 'border-indigo-200 bg-indigo-50/60',
    title: 'text-indigo-700',
    code: 'text-indigo-900',
    hint: 'text-indigo-600',
    button: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
  },
} as const

function InviteCode({ code, title, hint, tone }: InviteCodeProps) {
  const [copied, setCopied] = useState(false)
  const t = INVITE_TONES[tone]
  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={`mt-4 flex items-center gap-3 rounded-lg border p-4 ${t.box}`}>
      <div className="flex-1">
        <p className={`text-[10px] font-bold tracking-wider uppercase ${t.title}`}>{title}</p>
        <p className={`mt-1 font-mono text-base font-bold tracking-[0.25em] ${t.code}`}>{code}</p>
        <p className={`mt-1 text-[11px] ${t.hint}`}>{hint}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${t.button}`}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Schedule({ rows }: { rows: Dashboard['todaySchedule'] }) {
  const headers = ['Time', 'Class', 'Batch', 'Teacher', 'Room']
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-6 py-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <CalendarClock className="size-5 text-slate-700" /> Today's Class Schedule
        </h2>
        <Link to="/management/schedule" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          Manage Schedule
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-y border-slate-100">
              {headers.map((h) => (
                <th key={h} className="px-6 py-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="py-12 text-center text-sm text-slate-400 italic">
                  No classes scheduled today.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 text-sm text-slate-700">
                  <td className="px-6 py-3 font-medium">{r.time}</td>
                  <td className="px-6 py-3">{r.className}</td>
                  <td className="px-6 py-3">{r.batch}</td>
                  <td className="px-6 py-3">{r.teacher}</td>
                  <td className="px-6 py-3">{r.room}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 py-4 text-center text-xs text-slate-500">
        © {CURRENT_YEAR} EduAdmin Management System. Institutional Grade Security.
      </p>
    </section>
  )
}
