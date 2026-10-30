import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import type { PublicFeedbackForm } from '@/features/feedback/api'
import { StudentFeedbackView, type ViewProps } from './StudentFeedbackPage'
import { draftReady, viewState, type Draft } from './state'

const FORM: PublicFeedbackForm = {
  schoolName: 'Sunrise Academy',
  batchName: 'JEE A',
  cooldownMinutes: 15,
  students: [{ id: 's1', name: 'Aarav Sharma' }],
  teachers: [{ id: 'f1', name: 'Vikram Rao', subjects: ['Physics', 'Maths'] }],
}
const FULL: Draft = { studentId: 's1', facultyId: 'f1', rating: 4, comment: 'Explains kinematics clearly.' }
const noop = () => {}

function render(over: Partial<ViewProps>) {
  const props: ViewProps = { state: { kind: 'form', form: FORM }, draft: FULL, busy: false, error: null, sent: false, onDraft: noop, onSubmit: noop, onAgain: noop, ...over }
  const html = renderToStaticMarkup(<MemoryRouter><StudentFeedbackView {...props} /></MemoryRouter>)
  return html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"')
}
const sendButton = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? ''
const DISABLED = / disabled=""/

describe('the student feedback page', () => {
  it(`a 404 shows "This feedback link isn't active"`, () => {
    expect(viewState({ error: new ApiError(404, "This feedback link isn't active"), isPending: false })).toEqual({ kind: 'inactive' })
    expect(viewState({ error: new ApiError(500, 'Something went wrong'), isPending: false })).toEqual({ kind: 'failed', message: 'Something went wrong' })
    expect(viewState({ data: FORM, isPending: false })).toEqual({ kind: 'form', form: FORM })
    const html = render({ state: { kind: 'inactive' } })
    expect(html).toContain("This feedback link isn't active")
    expect(html).not.toContain('<form')
  })

  it('the form needs a name, a teacher, a rating and a 10-character comment before Send is enabled', () => {
    expect(draftReady(FULL)).toBe(true)
    expect(draftReady({ ...FULL, studentId: '' })).toBe(false)
    expect(draftReady({ ...FULL, facultyId: '' })).toBe(false)
    expect(draftReady({ ...FULL, rating: 0 })).toBe(false)
    expect(draftReady({ ...FULL, comment: '   too short   ' })).toBe(false)
    expect(draftReady({ ...FULL, comment: 'x'.repeat(1001) })).toBe(false)
    expect(sendButton(render({ draft: { ...FULL, rating: 0 } }))).toMatch(DISABLED)
    expect(sendButton(render({}))).not.toMatch(DISABLED)

    const html = render({})
    expect(html).toContain('Sunrise Academy')
    expect(html).toContain('JEE A')
    expect(html).toContain('Vikram Rao · Physics, Maths')
    expect(html).toContain('aria-label="4 stars"')
    expect(html).toContain(`${FULL.comment.length}/1000`)
  })

  it('after sending shows the thank-you and the 15-minute note', () => {
    const html = render({ sent: true })
    expect(html).toContain('Thanks! You can send more feedback after 15 minutes.')
    expect(html).not.toContain('<form')
  })

  it('a 429 shows the minutes left and keeps the typed comment', () => {
    const html = render({ error: 'You can send feedback again in 12 minutes' })
    expect(html).toContain('You can send feedback again in 12 minutes')
    expect(html).toContain(`>${FULL.comment}</textarea>`)
  })

  it('a 400 shows the server message', () => {
    expect(render({ error: 'Pick a teacher from the list' })).toContain('Pick a teacher from the list')
  })

  it('shows a busy Send while sending', () => {
    const button = sendButton(render({ busy: true }))
    expect(button).toMatch(DISABLED)
    expect(render({ busy: true })).toContain('Sending…')
  })
})
