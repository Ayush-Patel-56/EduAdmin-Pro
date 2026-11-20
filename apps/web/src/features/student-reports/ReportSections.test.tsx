import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StudentReport } from './api'
import { PerformanceSection } from './ReportSections'

const base = {
  summary: { overallPercent: null, grade: null, marks: null, totalMarks: null, testsTaken: 0, testsAbsent: 0, batchRank: null, accuracy: null, attemptRate: null, behaviourScore: null, attendanceRate: null, ptmMeetings: 0, overallFrom: null, attendanceFrom: null },
  performance: { subjects: [], tests: [] },
  termMarks: { terms: [], overall: null, attendance: null },
} as unknown as StudentReport

describe('5-in-1 Performance Report', () => {
  it('shows the term marks from report sheets and progress reports, with each term’s total and remarks', () => {
    const r = {
      ...base,
      summary: { ...base.summary, overallPercent: 78.89, grade: 'A', overallFrom: 'TERM_MARKS' },
      termMarks: {
        overall: { marks: 142, maxMarks: 180, percent: 78.89, grade: 'A' },
        attendance: 92,
        terms: [
          {
            term: 'TERM_1', label: 'Term 1', marks: 142, maxMarks: 180, percent: 78.89, grade: 'A', attendance: 92, teacherRemarks: 'Keep it up', principalRemarks: null,
            subjects: [
              { subject: 'Chemistry', marks: 64, maxMarks: 80, percent: 80, grade: 'A+', attendance: null, remarks: null },
              { subject: 'Physics', marks: 78, maxMarks: 100, percent: 78, grade: 'A', attendance: 92, remarks: 'Good' },
            ],
          },
        ],
      },
    } as unknown as StudentReport
    const html = renderToStaticMarkup(<PerformanceSection r={r} />)
    expect(html).toContain('Term marks')
    expect(html).toContain('Term 1')
    expect(html).toContain('Chemistry')
    expect(html).toContain('64 / 80')
    expect(html).toContain('142 / 180')
    expect(html).toContain('Keep it up')
    // The Overall tile says where its figure came from.
    expect(html).toContain('78.89%')
    expect(html).toContain('from term marks')
  })

  it('with no term marks, no term card', () => {
    expect(renderToStaticMarkup(<PerformanceSection r={base} />)).not.toContain('Term marks')
  })
})
