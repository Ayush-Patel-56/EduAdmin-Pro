import { ApiError } from '@/lib/api'
import type { PublicFeedbackForm } from '@/features/feedback/api'

export const MIN_COMMENT = 10
export const MAX_COMMENT = 1000

/** What the student has filled in so far; 0 stars and '' mean "not chosen yet". */
export type Draft = { studentId: string; facultyId: string; rating: number; comment: string }
export const EMPTY_DRAFT: Draft = { studentId: '', facultyId: '', rating: 0, comment: '' }

export type ViewState = { kind: 'loading' } | { kind: 'inactive' } | { kind: 'failed'; message: string } | { kind: 'form'; form: PublicFeedbackForm }

/** Send is enabled once every field is filled in the way the API will accept. */
export function draftReady(d: Draft): boolean {
  const length = d.comment.trim().length
  return !!d.studentId && !!d.facultyId && d.rating >= 1 && d.rating <= 5 && length >= MIN_COMMENT && length <= MAX_COMMENT
}

/** A 404 is a link that's switched off, replaced or mistyped; anything else is a fault worth saying. */
export function viewState(q: { data?: PublicFeedbackForm; error?: Error | null; isPending: boolean }): ViewState {
  if (q.data) return { kind: 'form', form: q.data }
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? { kind: 'inactive' } : { kind: 'failed', message: q.error.message }
  return { kind: 'loading' }
}
