import { useState } from 'react'
import { CircleCheck, CircleX, Clock, Star, TriangleAlert } from 'lucide-react'
import { STATUS_LABELS, type FeedbackStatus } from './api'

/** A read-only rating, 1-5 stars. */
export function Stars({ rating, size = 'sm' }: { rating: number; size?: 'xs' | 'sm' }) {
  const cls = size === 'xs' ? 'size-3' : 'size-3.5'
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${cls} ${n <= rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`} aria-hidden />
      ))}
    </span>
  )
}

/** Pick 1-5 stars (keyboard: the radio buttons behave as a group). */
export function StarInput({ value, onChange, label, disabled }: { value: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          className="rounded p-0.5 transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:outline-none disabled:cursor-not-allowed"
        >
          <Star className={`size-6 ${n <= shown ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`} aria-hidden />
        </button>
      ))}
    </div>
  )
}

const STATUS_STYLE: Record<FeedbackStatus, { className: string; icon: typeof Clock }> = {
  SUBMITTED: { className: 'border-slate-200 bg-slate-50 text-slate-700', icon: Clock },
  REVIEWED: { className: 'border-amber-200 bg-amber-50 text-amber-700', icon: TriangleAlert },
  ACTIONED: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CircleCheck },
  DISMISSED: { className: 'border-slate-200 bg-white text-slate-400', icon: CircleX },
}

export function StatusBadge({ status, icon = false }: { status: FeedbackStatus; icon?: boolean }) {
  const s = STATUS_STYLE[status]
  const Icon = s.icon
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${s.className}`}>
      {icon && <Icon className="size-3" />}
      {STATUS_LABELS[status]}
    </span>
  )
}
