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
 * Called when a signed-in request comes back 401, i.e. the session expired or
 * was revoked. /auth/* calls are excluded: a 401 there is a wrong password or
 * the "am I signed in?" check, which the auth screens and guards handle.
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
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.()
    throw new ApiError(res.status, body?.message ?? 'Something went wrong', body?.code)
  }
  return res.json() as Promise<T>
}
