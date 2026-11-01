export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 128

/** Why a new password (typed twice) can't be used yet, or null if it can. Same limits as the API. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`
  if (password.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters`
  if (password !== confirm) return "The two passwords don't match"
  return null
}
