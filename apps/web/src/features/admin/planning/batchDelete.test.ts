import { describe, expect, it } from 'vitest'
import { deleteBlockers } from './batchDelete'

describe('batch delete confirmation (#18 review)', () => {
  it('says how much handed-in work is waiting to be graded, and that it blocks the delete', () => {
    expect(deleteBlockers({ assignmentCount: 2, handedInCount: 3, reportCount: 0 })).toBe(
      '3 submissions handed in to its assignments are not graded yet, so it can’t be deleted: set an end date instead, or have its teachers delete those assignments first. ' +
        'If its assignments have recorded grades it can’t be deleted; set an end date instead. ',
    )
    expect(deleteBlockers({ assignmentCount: 1, handedInCount: 1, reportCount: 0 })).toMatch(/^1 submission handed in to its assignments is not graded yet/)
  })

  it('says nothing about handed-in work when there is none, and nothing at all without assignments', () => {
    expect(deleteBlockers({ assignmentCount: 2, handedInCount: 0, reportCount: 0 })).toBe('If its assignments have recorded grades it can’t be deleted; set an end date instead. ')
    expect(deleteBlockers({ assignmentCount: 0, handedInCount: 0, reportCount: 0 })).toBe('')
  })

  it('says daily reports block the delete too (they are records)', () => {
    expect(deleteBlockers({ assignmentCount: 0, handedInCount: 0, reportCount: 2 })).toBe('2 daily reports are recorded for it, so it can’t be deleted: set an end date instead. ')
    expect(deleteBlockers({ assignmentCount: 0, handedInCount: 0, reportCount: 1 })).toMatch(/^1 daily report is recorded for it/)
  })
})
