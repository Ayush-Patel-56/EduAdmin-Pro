import type { PaperQuestion, ResultsView } from '@/features/assessments/api'

/**
 * Import Test Results (PRD 4.5): one test's results from a sheet. The sheet
 * asks only for what the test doesn't know yet: who was present, and either
 * the total marks (with optional counts) or each question's answer when the
 * test has a paper (marks and counts are then worked out by the server, as on
 * the results sheet). Roll numbers are matched to the test's roster here and
 * again by the server; every score is checked by the server.
 */

export type ResultInput = {
  studentId: string
  present: boolean
  marks?: number | null
  correct?: number | null
  incorrect?: number | null
  unattempted?: number | null
  remarks?: string | null
  answers?: { testQuestionId: string; response?: string | null; marksAwarded?: number | null }[]
}

export type CheckedRow = { row: number; label: string; action: 'create' | 'update' | 'error'; errors: string[]; result?: ResultInput }

export const RESULT_HEADERS = ['Roll No', 'Name', 'Present', 'Marks', 'Correct', 'Incorrect', 'Unattempted']

/** The template's header: Q1…Qn appear when the test has a paper. */
export const resultHeader = (paper: PaperQuestion[]) => [...RESULT_HEADERS, ...paper.map((q) => `Q${q.position}`), 'Remarks']

/** The template: the test's roster, roll numbers and names filled in. */
export function resultTemplate(view: ResultsView): string[][] {
  return view.rows.map((r) => [r.student.rollNumber ?? '', r.student.fullName, '', '', '', '', '', ...view.paper.map(() => ''), ''])
}

const normalize = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')
const COLUMN_ALIASES: Record<string, string[]> = {
  rollNo: ['rollno', 'rollnumber', 'roll'],
  name: ['name', 'studentname', 'student'],
  present: ['present', 'attendance', 'presentabsent', 'status'],
  marks: ['marks', 'totalmarks', 'score'],
  correct: ['correct'],
  incorrect: ['incorrect', 'wrong'],
  unattempted: ['unattempted', 'skipped', 'blank'],
  remarks: ['remarks', 'remark', 'comments'],
}

/** "Yes", "P", "Present", "1" are present; "No", "A", "Absent", "0" absent; blank is unknown. */
export function presentOf(text: string): boolean | null | 'bad' {
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (['yes', 'y', 'p', 'present', '1', 'true'].includes(t)) return true
  if (['no', 'n', 'a', 'ab', 'absent', '0', 'false'].includes(t)) return false
  return 'bad'
}

const numberCell = (text: string) => (/^-?\d+(\.\d{1,2})?$/.test(text.trim()) ? Number(text.trim()) : null)
const countCell = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)

/** Each row of the sheet checked and turned into a result for the save. */
export function checkResults(rows: string[][], view: ResultsView): { rows: CheckedRow[]; missing: string[] } {
  const [header = [], ...body] = rows
  const at = (aliases: string[]) => header.findIndex((h) => aliases.includes(normalize(h)))
  const col = Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([k, a]) => [k, at(a)])) as Record<keyof typeof COLUMN_ALIASES, number>
  const qCol = new Map(view.paper.map((q) => [q.id, at([`q${q.position}`])]))
  const missing = [col.rollNo < 0 && 'Roll No', col.present < 0 && 'Present', col.marks < 0 && !view.paper.length && 'Marks'].filter((x): x is string => !!x)
  if (missing.length) return { rows: [], missing }
  const byRoll = new Map(view.rows.filter((r) => r.student.rollNumber).map((r) => [r.student.rollNumber!.toUpperCase(), r]))
  const seen = new Map<string, number>()
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const checked = body.map((r, i): CheckedRow => {
    const row = i + 2
    const errors: string[] = []
    const roll = cell(r, col.rollNo).toUpperCase()
    const entry = roll ? byRoll.get(roll) : undefined
    if (!roll) errors.push('Roll No is required')
    else if (!entry) errors.push(`No student with Roll No ${roll} on this test's roster`)
    if (roll && seen.has(roll)) errors.push(`Roll No ${roll} appears twice in this file (row ${seen.get(roll)})`)
    else if (roll) seen.set(roll, row)
    const label = `${roll || '—'} · ${entry?.student.fullName ?? (cell(r, col.name) || '(no name)')}`
    const remarks = cell(r, col.remarks) || null
    if (remarks && remarks.length > 500) errors.push('Remarks must be at most 500 characters')
    const answerCells = view.paper.map((q) => ({ q, text: cell(r, qCol.get(q.id) ?? -1) }))
    const hasAnswers = answerCells.some((a) => a.text)
    const marksText = cell(r, col.marks)
    let present = presentOf(cell(r, col.present))
    if (present === 'bad') {
      errors.push('Present must be Yes or No (or P / A)')
      present = null
    }
    if (present === null) {
      if (hasAnswers || marksText) present = true
      else errors.push('Say whether the student was present (Yes / No)')
    }
    let result: ResultInput | undefined
    if (present === false) {
      if (hasAnswers || marksText) errors.push("An absent student can't have marks or answers")
      result = { studentId: entry?.student.id ?? '', present: false, remarks }
    } else if (present === true) {
      if (hasAnswers) {
        const answers = answerCells.flatMap(({ q, text }): NonNullable<ResultInput['answers']> => {
          if (!text) return []
          if (q.type === 'SUBJECTIVE') {
            const m = numberCell(text)
            if (m === null) {
              errors.push(`Q${q.position}: give the marks awarded (a number)`)
              return []
            }
            return [{ testQuestionId: q.id, marksAwarded: m }]
          }
          return [{ testQuestionId: q.id, response: text }]
        })
        result = { studentId: entry?.student.id ?? '', present: true, remarks, answers }
      } else {
        const marks = numberCell(marksText)
        if (!marksText) errors.push(view.paper.length ? 'Enter the marks, or each question’s answer (Q columns)' : 'Marks is required')
        else if (marks === null) errors.push('Marks must be a number with up to two decimals')
        else if (marks > view.test.totalMarks) errors.push(`Marks can't be more than the test's ${view.test.totalMarks}`)
        const counts = (['correct', 'incorrect', 'unattempted'] as const).map((k) => {
          const text = cell(r, col[k])
          if (!text) return null
          const n = countCell(text)
          if (n === null) errors.push(`${k[0].toUpperCase()}${k.slice(1)} must be a whole number`)
          return n
        })
        result = { studentId: entry?.student.id ?? '', present: true, marks, correct: counts[0], incorrect: counts[1], unattempted: counts[2], remarks }
      }
    }
    if (errors.length || !entry) return { row, label, action: 'error', errors }
    return { row, label, action: entry.result ? 'update' : 'create', errors, result }
  })
  return { rows: checked, missing: [] }
}
