import { Link } from 'react-router-dom'
import { formatDate } from './format'

export type Announcement = { id: string; category: string; title: string; createdAt: string }

type AnnouncementListProps = {
  items: Announcement[]
  /** Shows a "Manage All" footer link when given (admins only). */
  manageTo?: string
}

export function AnnouncementList({ items, manageTo }: AnnouncementListProps) {
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
      {manageTo && (
        <Link
          to={manageTo}
          className="mt-6 block border-t border-slate-100 pt-4 text-center text-sm font-bold text-slate-900 hover:text-brand-600"
        >
          Manage All
        </Link>
      )}
    </>
  )
}
