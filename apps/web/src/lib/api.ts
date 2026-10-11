export class ApiError extends Error {
  readonly status: number
  /** Machine-readable reason from the API, e.g. "EMAIL_NOT_VERIFIED". */
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: (() => void) | null = null

/**
 * Auth endpoints whose 401 is part of their normal flow: a wrong password, the
 * "am I signed in?" check, or a logout of an already-ended session. Every other
 * request that comes back 401 (including /auth/preferences and
 * /auth/active-school) means the session expired.
 */
const EXPECTED_401 = /^\/auth\/(login|signup\/[a-z]+|verify-email|resend-verification|me|logout)$/

export const isSessionExpiry = (path: string, status: number) => status === 401 && !EXPECTED_401.test(path.split('?')[0])

/**
 * Called when a signed-in request comes back 401, i.e. the session expired or
 * was revoked.
 */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    if (isSessionExpiry(path, res.status)) onUnauthorized?.()
    throw new ApiError(res.status, body?.message ?? 'Something went wrong', body?.code)
  }
  return res.json() as Promise<T>
}
