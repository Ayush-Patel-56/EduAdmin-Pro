import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, isSessionExpiry, setUnauthorizedHandler } from './api'

describe('isSessionExpiry', () => {
  it('treats a 401 on normal API calls as an expired session', () => {
    expect(isSessionExpiry('/schools/abc/dashboard', 401)).toBe(true)
    expect(isSessionExpiry('/teacher/dashboard', 401)).toBe(true)
  })

  it('treats a 401 on auth calls that change state as an expired session too', () => {
    expect(isSessionExpiry('/auth/preferences', 401)).toBe(true)
    expect(isSessionExpiry('/auth/active-school', 401)).toBe(true)
  })

  it('does not treat the auth flow’s own 401s as expiry', () => {
    for (const path of ['/auth/login', '/auth/signup/teacher', '/auth/signup/admin', '/auth/verify-email', '/auth/resend-verification', '/auth/me', '/auth/logout']) {
      expect(isSessionExpiry(path, 401)).toBe(false)
    }
  })

  it('ignores a query string and other statuses', () => {
    expect(isSessionExpiry('/auth/me?x=1', 401)).toBe(false)
    expect(isSessionExpiry('/schools/abc/dashboard', 403)).toBe(false)
    expect(isSessionExpiry('/schools/abc/dashboard', 500)).toBe(false)
  })
})

describe('api() session handling', () => {
  afterEach(() => {
    setUnauthorizedHandler(null)
    vi.unstubAllGlobals()
  })

  const respond = (status: number, body: unknown = { message: 'nope' }) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

  it('calls the handler and still throws a typed error on an expired session', async () => {
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    respond(401, { message: 'Your session has expired', code: 'X' })
    await expect(api('/auth/preferences', { method: 'PATCH' })).rejects.toMatchObject({ status: 401, code: 'X' })
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('does not call the handler for a wrong password', async () => {
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    respond(401)
    await expect(api('/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('does not call the handler on success or on a 403', async () => {
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    respond(200, { ok: true })
    await expect(api('/schools')).resolves.toEqual({ ok: true })
    respond(403)
    await expect(api('/schools')).rejects.toMatchObject({ status: 403 })
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('sends cookies with every request', async () => {
    respond(200, {})
    await api('/schools')
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })
})
