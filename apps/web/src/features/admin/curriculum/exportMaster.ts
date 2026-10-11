import { MASTER_FIELDS, type MasterRow } from './api'

/** Downloads the (filtered) master sheet as a real .xlsx workbook. */
export async function exportMasterSheet(rows: MasterRow[], schoolName: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const header = ['Subject', ...MASTER_FIELDS].map((value) => ({ value, fontWeight: 'bold' as const }))
  const body = rows.map((r) => [
    r.subject,
    r.chapterName,
    r.chapterCode,
    r.board,
    r.classLevel,
    r.program,
    r.expectedHours,
    r.conceptName,
    r.conceptCode,
  ])
  const slug = schoolName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school'
  const date = new Date().toISOString().slice(0, 10)
  await writeXlsxFile([header, ...body], {
    sheet: 'Curriculum',
    stickyRowsCount: 1,
    columns: [14, 34, 18, 12, 10, 22, 14, 34, 22].map((width) => ({ width })),
  }).toFile(`curriculum-${slug}-${date}.xlsx`)
}
