import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { LoginPage } from './LoginPage'
import { PlaceholderPage } from './PlaceholderPage'
import { AdminSignupPage, TeacherSignupPage } from './SignupPages'
import { SignupRolePage } from './SignupRolePage'
import { VerifyEmailPage } from './VerifyEmailPage'

function render(page: ReactElement, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
const inputs = (html: string) => [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0])

describe('auth screens keep their fields and routes', () => {
  it('login: email + password fields, helper links, switch to signup, back to site', () => {
    const html = render(<LoginPage />, '/login')
    const fields = inputs(html)
    expect(fields).toHaveLength(2)
    expect(fields[0]).toMatch(/type="email"/)
    expect(fields[0]).toMatch(/autoComplete="email"|autocomplete="email"/i)
    expect(fields[1]).toMatch(/type="password"/)
    expect(fields[1]).toMatch(/current-password/)
    expect(html).toContain('>Login</button>')
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/', '/signup', '/verify-email', '/forgot-password']))
  })

  it('signup role choice links to the teacher and admin forms and back to login', () => {
    const html = render(<SignupRolePage />, '/signup')
    expect(html).toContain('Teacher')
    expect(html).toContain('Administration')
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/signup/teacher', '/signup/admin', '/login']))
  })

  it('teacher signup keeps its field names in order', () => {
    const html = render(<TeacherSignupPage />, '/signup/teacher')
    const names = inputs(html).map((i) => /name="([^"]+)"/.exec(i)?.[1])
    expect(names).toEqual(['fullName', 'email', 'password', 'department', 'schoolCode'])
    expect(html).toContain('Teacher Sign Up')
    expect(html).toContain('>Create Account</button>')
  })

  it('admin signup keeps its field names and invite code', () => {
    const html = render(<AdminSignupPage />, '/signup/admin')
    const names = inputs(html).map((i) => /name="([^"]+)"/.exec(i)?.[1])
    expect(names).toEqual(['fullName', 'email', 'password', 'employeeId', 'inviteCode'])
    expect(html).toContain('Admin invite code')
  })

  it('verify email and forgot password render with a way back to login', () => {
    const verify = render(<VerifyEmailPage />, '/verify-email')
    expect(verify).toContain('Verify Email')
    expect(verify).toContain('>Send code</button>')
    expect(hrefs(verify)).toContain('/login')
    expect(hrefs(render(<PlaceholderPage title="Forgot password" />))).toContain('/login')
  })

  it('uses the landing design shell and no em dashes', () => {
    for (const Page of [LoginPage, SignupRolePage, TeacherSignupPage, AdminSignupPage, VerifyEmailPage]) {
      const html = render(<Page />)
      expect(html).toContain('class="au"')
      expect(html).toContain('au-panel')
      expect(html).not.toContain('\u2014')
    }
  })
})
