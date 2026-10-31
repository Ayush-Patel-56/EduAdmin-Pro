import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CONTACT_EMAIL, LAST_UPDATED, SITE_URL } from './constants'

type Props = { title: string; description: string; path: '/privacy' | '/terms'; children: ReactNode }

/**
 * A public, indexable page of plain reading text: the Privacy Policy and the
 * Terms. React 19 lifts the title, description and canonical link into <head>.
 */
export function LegalLayout({ title, description, path, children }: Props) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-800">
      <title>{`${title} · EduAdmin Pro`}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`${SITE_URL}${path}`} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 font-bold text-slate-900">
            <span className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-xs text-white">EA</span>
            EduAdmin Pro
          </Link>
          <nav className="flex gap-4 text-sm font-semibold text-slate-600">
            <Link to="/privacy" className={path === '/privacy' ? 'text-slate-900' : 'hover:text-slate-900'}>Privacy</Link>
            <Link to="/terms" className={path === '/terms' ? 'text-slate-900' : 'hover:text-slate-900'}>Terms</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article className="legal rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">Last updated {LAST_UPDATED}</p>
          {children}
        </article>
        <p className="mt-6 text-center text-xs text-slate-500">
          Questions? Email <a className="font-semibold underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </main>
    </div>
  )
}

/** A numbered section with a heading and body text. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 space-y-3 text-[15px] leading-relaxed">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}
