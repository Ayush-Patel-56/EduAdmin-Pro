import { describe, expect, it } from 'vitest'
import type { SyllabusItem } from './api'
import { reportHtml } from './syllabusReport'

const item = (over: Partial<SyllabusItem>) => ({ id: 'i', subject: 'Physics', title: 'Kinematics', estimatedHours: 6, targetDates: '1-10 Nov', status: 'COMPLETED', remarks: null, ...over }) as SyllabusItem

describe('syllabus coverage report', () => {
  it("prints under the site's Content-Security-Policy: a linked stylesheet, no inline <style> or style attributes", () => {
    const html = reportHtml(
      { schoolName: 'Sunrise', program: 'JEE', batch: 'A', subject: 'All', items: [item({}), item({ id: 'j', status: 'IN_PROGRESS' })] },
      '/assets/syllabus-report.css',
    )
    expect(html).toContain('<link rel="stylesheet" href="/assets/syllabus-report.css">')
    expect(html).not.toMatch(/<style|style="/)
    expect(html).toContain('data-pct="50"')
    expect(html).toContain('class="pill COMPLETED"')
    expect(html).toContain('class="pill IN_PROGRESS"')
  })

  it('escapes what schools typed', () => {
    const html = reportHtml({ schoolName: '<b>x</b>', program: 'P', batch: 'B', subject: 'S', items: [item({ title: '"><img src=x>' })] }, '/a.css')
    expect(html).not.toContain('<img src=x>')
    expect(html).not.toContain('<b>x</b>')
  })
})
