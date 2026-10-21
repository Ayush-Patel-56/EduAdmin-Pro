import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { meQueryKey } from '@/features/auth/session'
import { LandingPage } from './LandingPage'
import { DEMO_MAILTO, INVITE_MAILTO } from './content'

function render(signedIn = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  if (signedIn) client.setQueryData(meQueryKey, { accountType: 'ADMIN' })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'))

describe('landing page', () => {
  it('renders the hero and main sections', () => {
    const html = render()
    expect(html).toContain('class="lp"')
    expect(html).toMatch(/<h1[^>]*>/)
    for (const id of ['day', 'modules', 'story', 'portals', 'faq', 'contact']) expect(html).toContain(`id="${id}"`)
  })

  it('sends every contact link to the school email with a subject', () => {
    const mails = hrefs(render()).filter((h) => h.startsWith('mailto:'))
    expect(mails.length).toBeGreaterThan(3)
    for (const m of mails) expect(m).toMatch(/^mailto:academicplanningsystem@gmail\.com\?subject=\S+/)
    expect(DEMO_MAILTO).toContain('subject=')
    expect(INVITE_MAILTO).toContain('subject=')
  })

  it('points Sign in and Set up my school at the real routes', () => {
    const links = hrefs(render())
    expect(links).toContain('/login')
    expect(links).toContain('/signup')
    expect(links).not.toContain('/app')
  })

  it('offers "Go to dashboard" instead of "Sign in" when signed in', () => {
    const html = render(true)
    expect(hrefs(html)).toContain('/app')
    expect(html).toContain('Go to dashboard')
    expect(html).not.toContain('>Sign in<')
  })

  it('uses no em dashes in its copy', () => {
    expect(render()).not.toContain('\u2014')
  })
})
