import { describe, expect, it } from 'vitest'
import { routes } from '@/routes'

describe('routes', () => {
  const paths = (routes[0].children ?? []).map((r) => r.path)

  it('serves the landing page at / and the sign-in page at /login', () => {
    expect(paths).toContain('/')
    expect(paths).toContain('/login')
  })

  it('keeps a /app hub that sends signed-in users to their portal', () => {
    expect(paths).toContain('/app')
  })

  it('still sends unknown paths to /', () => {
    expect(paths.at(-1)).toBe('*')
  })
})
