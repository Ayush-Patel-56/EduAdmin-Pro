import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PtmNote } from './api'
import { NoteCard } from './NoteCard'

const note: PtmNote = {
  id: 'n1',
  date: '2026-11-19',
  student: { id: 'st-1', fullName: 'Aadhya Shah', rollNumber: '52' },
  batch: { id: 'b1', name: 'J-b1' },
  teacherName: 'Ayush',
  parentName: 'Jaymin',
  parentAttended: true,
  discussion: 'Nothing discussed',
  actionItems: 'No action taken by the parents',
  followUpDate: null,
  createdAt: '2026-11-19T05:00:00.000Z',
}

describe('a PTM note card', () => {
  it("for admins: says which teacher logged it, can be printed, and can't be edited or deleted", () => {
    const html = renderToStaticMarkup(<NoteCard note={note} showTeacher />)
    expect(html).toContain('Logged by <span class="font-semibold text-slate-700">Ayush</span>')
    expect(html).toContain('Print')
    expect(html).not.toMatch(/aria-label="(Edit|Delete) notes/)
    expect(html).toContain('Nothing discussed')
    expect(html).toContain('No action taken by the parents')
  })

  it('for the teacher who logged it: edit and delete, and no "logged by" (it is theirs)', () => {
    const html = renderToStaticMarkup(<NoteCard note={note} canChange onEdit={() => {}} onDelete={() => {}} />)
    expect(html).toMatch(/aria-label="Edit notes for Aadhya Shah/)
    expect(html).toMatch(/aria-label="Delete notes for Aadhya Shah/)
    expect(html).not.toContain('Logged by')
  })
})
