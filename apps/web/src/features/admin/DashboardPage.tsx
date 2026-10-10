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
import { useAdminContext } from './adminContext'
import type { Dashboard, MouStatus } from './useDashboard'

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const formatDate = (iso: string) => dateFormat.format(new Date(iso))
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
            to="/dashboard/academic-planning"
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
          <Announcements items={dashboard.announcements} />
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
      <InviteCode code={school.inviteCode} />
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

function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50/70 p-4">
      <div className="flex-1">
        <p className="text-[10px] font-bold tracking-wider text-amber-700 uppercase">School Invite Code</p>
        <p className="mt-1 font-mono text-base font-bold tracking-[0.25em] text-amber-900">{code}</p>
        <p className="mt-1 text-[11px] text-amber-600">Share this code with teachers &amp; staff to join your school</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1.5 rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Announcements({ items }: { items: Dashboard['announcements'] }) {
  return (
    <>
      <ul className="flex-1 space-y-2">
        {items.length === 0 && <li className="text-xs text-slate-400 italic">No announcements yet.</li>}
        {items.map((a) => (
          <li key={a.id} className="rounded-lg border border-slate-100 p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-slate-600 uppercase">
                {a.category}
              </span>
              <time dateTime={a.createdAt} className="ml-auto text-[10px] text-slate-400">
                {formatDate(a.createdAt)}
              </time>
            </div>
            <p className="mt-1.5 text-xs font-semibold text-slate-900">{a.title}</p>
          </li>
        ))}
      </ul>
      <Link
        to="/dashboard/announcements"
        className="mt-6 block border-t border-slate-100 pt-4 text-center text-sm font-bold text-slate-900 hover:text-brand-600"
      >
        Manage All
      </Link>
    </>
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
        <Link to="/dashboard/schedule" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
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
