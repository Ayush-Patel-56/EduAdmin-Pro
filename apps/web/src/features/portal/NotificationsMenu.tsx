import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, CheckCheck, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/dates'
import { useDismiss } from '@/components/ui/useDismiss'

export type NotificationItem = {
  id: string
  kind: 'SYLLABUS_UPDATE'
  title: string
  body: string
  link: string | null
  readAt: string | null
  createdAt: string
  school: { id: string; name: string }
}
type Notifications = { unread: number; items: NotificationItem[] }

const KEY = ['notifications']

/** The bell: the account's notifications (Syllabus Updates), newest first, checked every minute. */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const client = useQueryClient()
  const navigate = useNavigate()
  const list = useQuery({ queryKey: KEY, queryFn: () => api<Notifications>('/notifications'), refetchInterval: 60_000, refetchOnWindowFocus: true })
  const unread = list.data?.unread ?? 0

  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' })
    await client.invalidateQueries({ queryKey: KEY })
  }

  async function openItem(n: NotificationItem) {
    setOpen(false)
    if (!n.readAt) {
      client.setQueryData<Notifications>(KEY, (old) => old && { unread: Math.max(0, old.unread - 1), items: old.items.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)) })
      void api(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => client.invalidateQueries({ queryKey: KEY }))
    }
    if (n.link) navigate(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
          if (!open) void list.refetch()
        }}
        className="relative flex text-slate-500 hover:text-slate-800"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute top-full right-0 z-40 mt-3 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.25)]"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => void readAll()} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          {!list.data ? (
            <div className="flex justify-center py-8">{list.error ? <p className="px-4 text-xs text-red-600">{list.error.message}</p> : <Loader2 className="size-5 animate-spin text-slate-300" />}</div>
          ) : list.data.items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <BellOff className="size-6 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No notifications yet</p>
              <p className="mt-1 text-[11px] text-slate-400">Syllabus updates show here (Account Preferences).</p>
            </div>
          ) : (
            <ul className="max-h-[min(420px,60vh)] divide-y divide-slate-100 overflow-y-auto">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => void openItem(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/60'}`}>
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{n.title}</span>
                      <span className="block text-xs text-slate-600">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{n.school.name} · {timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
