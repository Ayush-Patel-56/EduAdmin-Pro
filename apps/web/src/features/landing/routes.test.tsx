import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from '@/routes'
import { NotFoundPage } from '@/features/legal/NotFoundPage'
import { PrivacyPage } from '@/features/legal/PrivacyPage'
import { TermsPage } from '@/features/legal/TermsPage'

describe('routes', () => {
  const paths = (routes[0].children ?? []).map((r) => r.path)

  it('serves the landing page at / and the sign-in page at /login', () => {
    expect(paths).toContain('/')
    expect(paths).toContain('/login')
  })

  it('keeps a /app hub that sends signed-in users to their portal', () => {
    expect(paths).toContain('/app')
  })

  it('has public Privacy Policy and Terms pages, each with its own title, description and canonical link', () => {
    expect(paths).toContain('/privacy')
    expect(paths).toContain('/terms')
    for (const [Page, path, title] of [[PrivacyPage, '/privacy', 'Privacy Policy'], [TermsPage, '/terms', 'Terms of Service']] as const) {
      const html = renderToStaticMarkup(<MemoryRouter><Page /></MemoryRouter>)
      expect(html).toContain(`<title>${title} · EduAdmin Pro</title>`)
      expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/)
      expect(html).toContain(`rel="canonical" href="https://eduadmin-web.vercel.app${path}"`)
      expect(html).toContain('academicplanningsystem@gmail.com')
    }
  })

  it('answers unknown paths with a not-found page search engines skip, not a copy of the landing page', () => {
    expect(paths.at(-1)).toBe('*')
    const html = renderToStaticMarkup(<MemoryRouter><NotFoundPage /></MemoryRouter>)
    expect(html).toContain('<meta name="robots" content="noindex"')
    expect(html).toContain('href="/"')
  })
})
