import { describe, expect, it } from 'vitest'
import { markNumber, subjectMarksError } from './marksForm'

describe('Generate / Edit Progress Report: the marks typed in', () => {
  it('reads a number with up to two decimals, with an optional minus (typed or the Unicode one)', () => {
    expect(markNumber('72.5')).toBe(72.5)
    expect(markNumber(' -5 ')).toBe(-5)
    expect(markNumber('−2.25')).toBe(-2.25)
    expect(Object.is(markNumber('-0'), 0)).toBe(true)
    for (const bad of ['', '-', '--5', '5-', '1.234', 'abc', '+5']) expect(markNumber(bad)).toBeNull()
  })

  it('negative marks (negative marking) are fine down to minus the total; the total stays more than 0', () => {
    const row = (marks: string, maxMarks = '50') => [{ subject: 'Physics', marks, maxMarks }]
    expect(subjectMarksError(row('-12.5'))).toBeNull()
    expect(subjectMarksError(row('-50'))).toBeNull()
    expect(subjectMarksError(row('-50.5'))).toBe('Physics: marks obtained can’t be less than minus the total (-50)')
    expect(subjectMarksError(row('51'))).toBe('Physics: marks obtained can’t be more than the total')
    expect(subjectMarksError(row('5', '-50'))).toBe('Physics: total marks must be more than 0')
    expect(subjectMarksError(row('5', '0'))).toBe('Physics: total marks must be more than 0')
    expect(subjectMarksError(row('five'))).toBe('Physics: enter marks as numbers with up to two decimals')
    expect(subjectMarksError([{ subject: '', marks: '1', maxMarks: '5' }])).toBe('Select each subject')
    expect(subjectMarksError([])).toBe('Add at least one subject')
    expect(subjectMarksError([...row('1'), ...row('2')])).toBe('Each subject can be on the report once')
  })
})
