import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ReportOptions } from './api'
import { ImportMarksDialog } from './ImportMarksDialog'

const options: ReportOptions = {
  currentYear: 2026,
  years: [{ year: 2026, label: '2026-27' }],
  terms: [{ key: 'TERM_1', label: 'Term 1' }],
  subjects: ['Physics'],
  gradeScale: [],
  needsAttentionPercent: 40,
  canWrite: true,
  canDeleteSheets: true,
  batches: [{ id: 'b1', name: 'JEE A', program: 'JEE' }],
}

describe('Import student report', () => {
  it('says the sheet can be dragged in as well as selected', () => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ImportMarksDialog base="/schools/s1/student-reports" options={options} onClose={() => {}} />
      </QueryClientProvider>,
    )
    expect(html).toContain('Pick the class, subject and term, then drag the file here or click to select it')
  })
})
