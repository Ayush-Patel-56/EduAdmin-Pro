import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import './auth.css'

/** Shared shell for the auth and onboarding screens: logo bar plus a centred stage. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="au">
      <header className="au-top">
        <Link to="/" viewTransition className="au-logo" aria-label="EduAdmin Pro home">
          <b>EA</b>
          <span>
            EduAdmin Pro<small>School Management</small>
          </span>
        </Link>
        <Link to="/" viewTransition className="au-site">
          ← Back to site
        </Link>
      </header>
      <main className="au-main">{children}</main>
    </div>
  )
}
