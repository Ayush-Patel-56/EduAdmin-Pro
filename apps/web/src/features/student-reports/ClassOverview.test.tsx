import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ReportOptions } from './api'
import { ClassOverview } from './ClassOverview'

const base = '/schools/s1/student-reports'
const options: ReportOptions = {
  currentYear: 2026,
  years: [{ year: 2026, label: '2026-27' }],
  terms: [{ key: 'TERM_1', label: 'Term 1' }],
  subjects: ['Physics'],
  gradeScale: [],
  needsAttentionPercent: 65,
  canWrite: true,
  canDeleteSheets: true,
  batches: [{ id: 'b1', name: 'JEE A', program: 'JEE' }, { id: 'b2', name: 'JEE B', program: 'JEE' }],
}

function render() {
  const client = new QueryClient()
  client.setQueryData([base, 'options'], options)
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ClassOverview base={base} school="Test School" />
    </QueryClientProvider>,
  )
  return { html, client }
}

describe('Uploaded Reports Overview', () => {
  it('has no "All classes": a class is picked first, and only then is anything loaded or shown', () => {
    const { html, client } = render()
    expect(html).not.toContain('All classes')
    expect(html).toContain('Select a class')
    expect(html).toContain('JEE A')
    expect(html).toContain('Pick a class to see its performance trend')
    // Nothing is asked of the API for the overview or the sheet list until then.
    const queries = client.getQueryCache().findAll({ queryKey: [base] })
    const gated = queries.filter((q) => q.queryKey[1] === 'overview' || q.queryKey[1] === 'sets')
    expect(gated.length).toBe(2)
    for (const q of gated) expect(q.isDisabled()).toBe(true)
  })
})
