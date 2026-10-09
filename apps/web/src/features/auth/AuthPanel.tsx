import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type AuthPanelProps = {
  side: 'left' | 'right'
  title: string
  description: string
  ctaLabel: string
  ctaTo: string
}

const sideClasses = {
  left: 'md:rounded-l-3xl md:rounded-r-[110px] shadow-[12px_0_40px_-12px_rgba(79,70,229,0.35)]',
  right: 'md:order-last md:rounded-r-3xl md:rounded-l-[110px] shadow-[-12px_0_40px_-12px_rgba(79,70,229,0.35)]',
}

// The purple call-to-action half of the auth card.
export function AuthPanel({ side, title, description, ctaLabel, ctaTo }: AuthPanelProps) {
  return (
    <section
      className={`relative z-10 flex flex-col items-center justify-center max-md:rounded-b-[56px] bg-linear-to-br from-brand-400 via-brand-500 to-brand-600 px-8 py-14 text-center text-white md:w-1/2 md:py-0 ${sideClasses[side]}`}
    >
      <h2 className="text-[34px] font-extrabold tracking-tight">{title}</h2>
      <p className="mt-3 max-w-[260px] text-[15px] leading-relaxed font-medium text-white/85">{description}</p>
      <Link
        to={ctaTo}
        className="mt-11 rounded-lg border border-white/40 bg-white/10 px-10 py-3 text-sm font-bold tracking-wide uppercase transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
      >
        {ctaLabel}
      </Link>
    </section>
  )
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-[896px] flex-col overflow-hidden rounded-3xl bg-white/90 shadow-[0_30px_80px_-20px_rgba(79,70,229,0.18)] md:min-h-[600px] md:flex-row">
      {children}
    </div>
  )
}
