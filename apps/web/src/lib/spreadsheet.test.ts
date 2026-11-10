import { describe, expect, it } from 'vitest'
import { parseCsv, readSpreadsheet, rowsToRecords, toCsv } from './spreadsheet'

describe('toCsv', () => {
  it('neutralises cells a spreadsheet would run as formulas, including ones hidden behind a tab or carriage return', () => {
    const csv = toCsv([['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)', '\t=cmd', '\r=cmd', 'plain', -5]])
    expect(csv.split(',')).toEqual(["\"'=HYPERLINK(\"\"http://x\"\")\"", "'+1", "'-2", "'@SUM(A1)", "'\t=cmd", "\"'\r=cmd\"", 'plain', '-5'])
  })
})

/** Faculty header from a client file re-saved in Excel as .csv (tabs + CRLF). Row data is sample, not the client's. */
const FACULTY_EXCEL_CSV = [
  'Name\tEmployee ID\tEmail\tPhone\tAlt Phone\tDate of Birth (YYYY-MM-DD)\tGender\tAddress Line 1\tCity\tState\tPincode\tSubject\tSpecialization\tQualification\tExperience (Years)\tJoining Date (YYYY-MM-DD)\tStatus\tBatches\tBio\tProfile Image URL',
  'Anita Rao\tEMP-201\tanita.rao@example.com\t9876500011\t\t14/03/1985\tfemale\t22 Park Street\tHyderabad\tTelangana\t500001\tPhysics\tMechanics\tM.Sc. Physics\t8\t01/06/2020\tACTIVE\t\tSpecializes in mechanics and problem solving.\t',
].join('\r\n')

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array<ArrayBuffer> {
  const bom = littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]
  const body = new Uint8Array(bom.length + text.length * 2)
  body.set(bom)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const at = bom.length + i * 2
    if (littleEndian) {
      body[at] = code & 0xff
      body[at + 1] = code >> 8
    } else {
      body[at] = code >> 8
      body[at + 1] = code & 0xff
    }
  }
  return body
}

describe('parseCsv', () => {
  it('parses comma-separated rows', () => {
    expect(parseCsv('Name,Email\nAnita,anita@example.com')).toEqual([
      ['Name', 'Email'],
      ['Anita', 'anita@example.com'],
    ])
  })

  it('parses tab-separated rows, including Excel CRLF line endings', () => {
    expect(parseCsv('Name\tEmail\r\nAnita\tanita@example.com\r\n')).toEqual([
      ['Name', 'Email'],
      ['Anita', 'anita@example.com'],
    ])
  })

  it('parses semicolon-separated rows', () => {
    expect(parseCsv('Name;Email\nAnita;anita@example.com')).toEqual([
      ['Name', 'Email'],
      ['Anita', 'anita@example.com'],
    ])
  })

  it('keeps other separators inside quoted fields', () => {
    expect(parseCsv('Name,Notes\n"Rao, Anita; tab:\there",ok')).toEqual([
      ['Name', 'Notes'],
      ['Rao, Anita; tab:\there', 'ok'],
    ])
  })

  it('does not treat separators inside the quoted header as the delimiter', () => {
    expect(parseCsv('"Name, full";Email\nAnita;a@x.com')).toEqual([
      ['Name, full', 'Email'],
      ['Anita', 'a@x.com'],
    ])
  })

  it('maps a tab-separated faculty sheet header to the name field', () => {
    const { records, missing } = rowsToRecords(parseCsv(FACULTY_EXCEL_CSV), { name: ['Name', 'Full Name'] })
    expect(missing).toEqual([])
    expect(records[0]?.name).toBe('Anita Rao')
  })

  it('strips a UTF-8 BOM and still detects the delimiter', () => {
    expect(parseCsv('\uFEFFName,Email\nA,B')).toEqual([
      ['Name', 'Email'],
      ['A', 'B'],
    ])
  })

  it('defaults to commas when the header has no separator', () => {
    expect(parseCsv('Name\nAnita Rao')).toEqual([['Name'], ['Anita Rao']])
  })

  it('drops empty rows', () => {
    expect(parseCsv('Name,Email\n\nA,B\n,\n')).toEqual([
      ['Name', 'Email'],
      ['A', 'B'],
    ])
  })
})

describe('readSpreadsheet', () => {
  it('decodes a UTF-16LE CSV with a BOM (Excel Unicode Text)', async () => {
    const file = new File([encodeUtf16('Name\tEmail\r\nAnita Rao\tanita.rao@example.com\r\n', true)], 'faculty.csv', {
      type: 'text/csv',
    })
    expect(await readSpreadsheet(file)).toEqual([
      ['Name', 'Email'],
      ['Anita Rao', 'anita.rao@example.com'],
    ])
  })

  it('decodes a UTF-16BE CSV with a BOM', async () => {
    const file = new File([encodeUtf16('Name,Email\nA,B', false)], 'faculty.csv', { type: 'text/csv' })
    expect(await readSpreadsheet(file)).toEqual([
      ['Name', 'Email'],
      ['A', 'B'],
    ])
  })

  it('reads a UTF-8 comma-separated CSV', async () => {
    const file = new File(['Name,Email\nAnita,a@x.com'], 'faculty.csv', { type: 'text/csv' })
    expect(await readSpreadsheet(file)).toEqual([
      ['Name', 'Email'],
      ['Anita', 'a@x.com'],
    ])
  })
})
