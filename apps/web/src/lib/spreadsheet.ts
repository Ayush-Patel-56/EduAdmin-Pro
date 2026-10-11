// Reading and writing the CSV / Excel files used by bulk imports and exports.
// Files are parsed in the browser into plain text rows; the API validates
// every row before anything is saved.

export const MAX_IMPORT_ROWS = 1000

/** RFC 4180 CSV: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/**
 * Builds CSV text. Cells that a spreadsheet would treat as a formula
 * (=, +, -, @) are prefixed with ' so an export can't run code when opened.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          let text = cell === null || cell === undefined ? '' : String(cell)
          if (/^[=+\-@]/.test(text)) text = `'${text}`
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
        })
        .join(','),
    )
    .join('\r\n')
}

export function downloadFile(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  // BOM so Excel opens UTF-8 CSVs with the right characters.
  const blob = new Blob([type.startsWith('text/csv') ? '﻿' + content : content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const pad = (n: number) => String(n).padStart(2, '0')

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  // Excel date cells come back as Date objects; imports expect YYYY-MM-DD.
  if (cell instanceof Date) return `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`
  return String(cell)
}

/** Reads a .csv or .xlsx file into rows of text cells (first row = headers). */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsv(await file.text())
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    const rows = await readSheet(file)
    return rows.map((r) => r.map(cellText)).filter((r) => r.some((c) => c.trim() !== ''))
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files aren’t supported. Save the sheet as .xlsx or .csv and try again.')
  throw new Error('Choose a .csv or .xlsx file')
}

const normalizeHeader = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')

/**
 * Turns header + rows into objects keyed by our field names. `columns` maps
 * each field to the header spellings it accepts, e.g. { title: ['Chapter Title'] }.
 * Unknown columns are ignored; empty cells are left out.
 */
export function rowsToRecords<K extends string>(
  rows: string[][],
  columns: Record<K, string[]>,
): { records: Partial<Record<K, string>>[]; missing: K[] } {
  const [header = [], ...body] = rows
  const index = new Map<K, number>()
  for (const [field, aliases] of Object.entries(columns) as [K, string[]][]) {
    const wanted = aliases.map(normalizeHeader)
    const at = header.findIndex((h) => wanted.includes(normalizeHeader(h)))
    if (at >= 0) index.set(field, at)
  }
  const missing = (Object.keys(columns) as K[]).filter((k) => !index.has(k))
  const records = body.map((r) => {
    const record: Partial<Record<K, string>> = {}
    for (const [field, at] of index) {
      const value = (r[at] ?? '').trim()
      if (value) record[field] = value
    }
    return record
  })
  return { records, missing }
}
