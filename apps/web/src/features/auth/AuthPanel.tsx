import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { TOASTS } from '@/features/landing/content'

type AuthPanelProps = {
  side: 'left' | 'right'
  title: string
  description: string
  ctaLabel: string
  ctaTo: string
}

const PILL_MS = 2800
const WEEK = [62, 80, 54, 92, 70, 86]

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Small animated product preview with the cycling "what just happened" pill from the landing page. */
function LivePreview() {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const t = setInterval(() => setI((n) => (n + 1) % TOASTS.length), PILL_MS)
    return () => clearInterval(t)
  }, [])
  const [title, meta] = TOASTS[i]

  return (
    <div className="au-prev" aria-hidden="true">
      <div className="au-prev-h">
        <b>Today at your school</b>
        <span className="au-live">
          <i /> Live
        </span>
      </div>
      <div className="au-stats">
        <div className="au-stat">
          <small>Attendance</small>
          <b>93%</b>
          <div className="bar"><i style={{ width: '93%' }} /></div>
        </div>
        <div className="au-stat">
          <small>Reports</small>
          <b>15/24</b>
          <div className="bar"><i style={{ width: '62%' }} /></div>
        </div>
        <div className="au-stat">
          <small>Tests</small>
          <b>4</b>
          <div className="bar"><i style={{ width: '40%' }} /></div>
        </div>
      </div>
      <div className="au-week">
        {WEEK.map((h, n) => (
          <i key={n} style={{ height: `${h}%`, animationDelay: `${n * 0.18}s` }} />
        ))}
      </div>
      <div key={i} className="au-pill au-pill-in">
        <span className="dot"><Check className="size-3.5" /></span>
        <b>{title}</b>
        <span>{meta}</span>
      </div>
    </div>
  )
}

/** Navy side of the auth card: switch prompt plus a live product preview. */
export function AuthPanel({ side, title, description, ctaLabel, ctaTo }: AuthPanelProps) {
  return (
    <section className={`au-panel ${side}`}>
      <span className="au-dots" />
      <div className="relative">
        <h2>{title}</h2>
        <p className="d">{description}</p>
        <Link to={ctaTo} viewTransition className="au-cta">
          {ctaLabel} <ArrowRight className="size-4" />
        </Link>
      </div>
      <div className="relative pb-5">
        <LivePreview />
      </div>
    </section>
  )
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="au-card">{children}</div>
}

/** Form half of the auth card. */
export function AuthFormSide({ children }: { children: ReactNode }) {
  return <section className="au-form">{children}</section>
}
