import { describe, expect, it } from 'vitest'
import type { DailyReport } from '@/features/daily-reports/api'
import { reportRows } from './exportDailyReports'

const report: DailyReport = {
  id: 'r1',
  date: '2026-10-15',
  teacher: { id: 'f1', name: 'Ayush' },
  batch: { id: 'b1', name: 'Batch 1A' },
  program: { id: 'p1', name: 'JEE' },
  subject: 'Physics',
  chapter: 'Kinematics',
  topics: 'Projectile motion',
  homework: null,
  observations: null,
  late: true,
  submittedAt: '2026-10-17T04:45:00.000Z',
  edited: false,
}

describe('daily report exports', () => {
  it('Submitted At carries its day (a Late report for 15 Oct sent on 17 Oct), in India time', () => {
    const [row] = reportRows([report])
    expect(row[0]).toBe('2026-10-15')
    expect(row[6]).toBe('Late')
    expect(row[7]).toBe('17 Oct 2026, 10:15 am')
  })
})
