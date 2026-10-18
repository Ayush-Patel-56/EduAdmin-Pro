import type { Batch } from '@/features/academic/api'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What can stop a batch from being deleted, for the delete confirmation. The
 * API decides (409); this only says so up front.
 */
export function deleteBlockers(b: Pick<Batch, 'assignmentCount' | 'handedInCount' | 'reportCount'>): string {
  const parts: string[] = []
  if (b.reportCount > 0) {
    parts.push(
      `${plural(b.reportCount, 'daily report')} ${b.reportCount === 1 ? 'is' : 'are'} recorded for it, so it can’t be deleted: set an end date instead.`,
    )
  }
  if (b.handedInCount > 0) {
    parts.push(
      `${plural(b.handedInCount, 'submission')} handed in to its assignments ${b.handedInCount === 1 ? 'is' : 'are'} not graded yet, so it can’t be deleted: set an end date instead, or have its teachers delete those assignments first.`,
    )
  }
  if (b.assignmentCount > 0) parts.push('If its assignments have recorded grades it can’t be deleted; set an end date instead.')
  return parts.map((p) => `${p} `).join('')
}
