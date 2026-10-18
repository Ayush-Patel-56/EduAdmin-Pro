import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { BAND_LABELS, DIFFICULTY_LABELS, TYPE_LABELS, fileSlug, type StudentReport } from './api'

type Cell = string | number | null
type Section = { name: string; header: string[]; rows: Cell[][] }

const generated = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) + ' IST'
const v = (n: number | null | undefined) => (n === null || n === undefined ? null : Number(n.toFixed(2)))

/**
 * The report as tables, one per section, for every export (Excel, CSV, PDF).
 * Only report fields go out: no contact details, Aadhar or guardians (HLD
 * 9.7: sensitive fields are filtered from every format).
 */
export function reportSections(r: StudentReport): Section[] {
  const s = r.summary
  const topics = [...r.topics.strong, ...r.topics.average, ...r.topics.weak]
  return [
    {
      name: 'Summary',
      header: ['Field', 'Value'],
      rows: [
        ['Student', r.student.fullName],
        ['Roll No', r.student.rollNumber],
        ['Admission No', r.student.admissionNumber],
        ['Batch', r.student.batch?.name ?? null],
        ['Program', r.student.program],
        ['Class', r.student.classLevel],
        ['Academic year', r.year.label],
        ['Overall %', v(s.overallPercent)],
        ['Grade', s.grade],
        ['Total marks', s.marks === null ? null : `${v(s.marks)} / ${s.totalMarks}`],
        ['Tests sat', s.testsTaken],
        ['Tests absent', s.testsAbsent],
        ['Batch rank', s.batchRank ? `${s.batchRank.rank} of ${s.batchRank.of}` : null],
        ['Percentile', s.batchRank?.percentile ?? null],
        ['Accuracy %', v(s.accuracy)],
        ['Attempt rate %', v(s.attemptRate)],
        ['Behaviour score (/5)', s.behaviourScore],
        ['Attendance %', v(s.attendanceRate)],
        ['PTM meetings', s.ptmMeetings],
        ['Generated', generated(r.generatedAt)],
        ['Worked out from', `${r.coverage.tests} test result(s), ${r.coverage.answers} graded answer(s), ${r.coverage.gradedAssignments} graded assignment(s), ${r.coverage.ratings} rating(s), ${r.coverage.classes} class(es) of attendance, ${r.coverage.ptmNotes} PTM note(s)`],
      ],
    },
    {
      name: 'Performance',
      header: ['Subject', 'Marks', 'Total', '%', 'Grade', 'Tests'],
      rows: r.performance.subjects.map((x) => [x.subject, v(x.marks), x.totalMarks, v(x.percent), x.grade, x.tests]),
    },
    {
      name: 'Tests',
      header: ['Test', 'Subject', 'Date', 'Present', 'Marks', 'Total', '%', 'Grade', 'Rank', 'Of', 'Percentile'],
      rows: r.performance.tests.map((t) => [t.title, t.subject, t.date, t.present ? 'Yes' : 'Absent', v(t.marks), t.totalMarks, v(t.percent), t.grade, t.rank, t.of, t.percentile]),
    },
    {
      name: 'Test Analysis',
      header: ['Group', 'Questions', 'Correct', 'Partly correct', 'Incorrect', 'Unattempted', 'Accuracy %', 'Attempt rate %'],
      rows: [
        ['All tests (counts)', r.analysis.questions, r.analysis.correct, null, r.analysis.incorrect, r.analysis.unattempted, v(r.analysis.accuracy), v(r.analysis.attemptRate)],
        ...r.analysis.byType.map((t): Cell[] => [`Type: ${TYPE_LABELS[t.type] ?? t.type}`, t.questions, t.correct, t.partial, t.incorrect, t.unattempted, v(t.accuracy), v(t.attemptRate)]),
        ...r.analysis.byDifficulty.map((t): Cell[] => [`Difficulty: ${DIFFICULTY_LABELS[t.difficulty] ?? t.difficulty}`, t.questions, t.correct, t.partial, t.incorrect, t.unattempted, v(t.accuracy), v(t.attemptRate)]),
      ],
    },
    {
      name: 'Topic Strength',
      header: ['Band', 'Subject', 'Chapter', 'Topic', 'Score %', 'Test %', 'Test questions', 'Assignment %', 'Assignments'],
      rows: topics.map((t) => [BAND_LABELS[t.band], t.subject, t.chapter, t.topic, v(t.percent), v(t.test?.percent), t.test?.questions ?? null, v(t.assignments?.percent), t.assignments?.count ?? null]),
    },
    {
      name: 'Error Log',
      header: ['Test', 'Date', 'Q', 'Subject', 'Topic', 'Difficulty', 'Type', 'Outcome', 'Answered', 'Correct answer', 'Marks', 'Out of', 'Question'],
      rows: r.mistakes.recent.map((m) => [m.test.title, m.test.date, m.question, m.subject, m.topic, DIFFICULTY_LABELS[m.difficulty] ?? m.difficulty, TYPE_LABELS[m.type] ?? m.type, m.outcome === 'PARTIAL' ? 'Partly correct' : 'Incorrect', m.response, m.correctAnswer, m.marksAwarded, m.marks, m.text]),
    },
    {
      name: 'Teacher Feedback',
      header: ['Item', 'Value'],
      rows: [
        ['Days evaluated', r.feedback.ratings?.days ?? 0],
        ['Attitude (/5)', r.feedback.ratings?.attitude ?? null],
        ['Behaviour (/5)', r.feedback.ratings?.behaviour ?? null],
        ['Focus (/5)', r.feedback.ratings?.focus ?? null],
        ['Interaction (/5)', r.feedback.ratings?.interaction ?? null],
        ['Behaviour score (/5)', r.feedback.ratings?.score ?? null],
        ['Attendance %', v(r.feedback.attendance.rate)],
        ['Classes (present / late / absent / excused)', `${r.feedback.attendance.present} / ${r.feedback.attendance.late} / ${r.feedback.attendance.absent} / ${r.feedback.attendance.excused}`],
        ['PTM meetings', r.feedback.ptm.meetings],
        ['Parent attendance %', v(r.feedback.ptm.parentAttendanceRate)],
      ],
    },
    {
      name: 'PTM Notes',
      header: ['Date', 'Teacher', 'Parent', 'Parent attended', 'Discussion', 'Action items', 'Follow-up'],
      rows: r.feedback.ptm.notes.map((n) => [n.date, n.teacherName, n.parentName, n.parentAttended ? 'Yes' : 'No', n.discussion, n.actionItems, n.followUpDate]),
    },
  ]
}

const fileName = (r: StudentReport, ext: string) => `5-in-1-${fileSlug(r.student.fullName)}${r.student.rollNumber ? `-${fileSlug(r.student.rollNumber)}` : ''}-${r.year.label}.${ext}`

export async function exportReportXlsx(r: StudentReport) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const sheets = reportSections(r).map((s) => ({
    sheet: s.name,
    stickyRowsCount: 1,
    columns: s.header.map((h) => ({ width: Math.min(48, Math.max(12, h.length + 4)) })),
    data: [s.header.map((value) => ({ value, fontWeight: 'bold' as const })), ...s.rows.map((row) => row.map((value) => ({ value: value ?? '' })))],
  }))
  await writeXlsxFile(sheets).toFile(fileName(r, 'xlsx'))
}

export function exportReportCsv(r: StudentReport) {
  const rows: Cell[][] = []
  for (const s of reportSections(r)) {
    rows.push([s.name.toUpperCase()], s.header, ...s.rows, [])
  }
  downloadFile(fileName(r, 'csv'), toCsv(rows))
}

/** The 5-in-1 report on A4: header, then each section as a table. */
export async function exportReportPdf(r: StudentReport, school: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const s = r.summary
  doc.setFontSize(15)
  doc.text(school, 40, 44)
  doc.setFontSize(11)
  doc.setTextColor(90)
  doc.text(`5-in-1 Student Report · ${r.year.label}`, 40, 62)
  doc.setTextColor(20)
  doc.setFontSize(13)
  doc.text(`${r.student.fullName}${r.student.rollNumber ? ` (Roll ${r.student.rollNumber})` : ''}`, 40, 88)
  doc.setFontSize(9.5)
  doc.setTextColor(90)
  doc.text([r.student.batch?.name, r.student.program, r.student.classLevel].filter(Boolean).join(' · ') || 'No batch', 40, 103)
  const tile = (x: number, label: string, value: string) => {
    doc.setDrawColor(226, 232, 240)
    doc.roundedRect(x, 116, 122, 46, 6, 6)
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(label.toUpperCase(), x + 9, 131)
    doc.setFontSize(13)
    doc.setTextColor(15, 23, 42)
    doc.text(value, x + 9, 151)
  }
  tile(40, 'Overall', s.overallPercent === null ? '—' : `${v(s.overallPercent)}% ${s.grade ?? ''}`)
  tile(170, 'Batch rank', s.batchRank ? `#${s.batchRank.rank} of ${s.batchRank.of}` : '—')
  tile(300, 'Behaviour', s.behaviourScore === null ? '—' : `${s.behaviourScore} / 5`)
  tile(430, 'Attendance', s.attendanceRate === null ? '—' : `${v(s.attendanceRate)}%`)
  let y = 180
  for (const section of reportSections(r).slice(1)) {
    if (!section.rows.length) continue
    autoTable(doc, {
      startY: y,
      head: [[{ content: section.name, colSpan: section.header.length, styles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 10 } }], section.header],
      body: section.rows.map((row) => row.map((c) => (c === null ? '—' : String(c)))),
      styles: { fontSize: 7.5, cellPadding: 3.5, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [15, 23, 42], fontSize: 7.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 40, right: 40 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setTextColor(130)
    doc.text(`Generated ${generated(r.generatedAt)} · ${r.coverage.tests} test result(s), ${r.coverage.gradedAssignments} graded assignment(s), ${r.coverage.ratings} rating(s), ${r.coverage.classes} class(es), ${r.coverage.ptmNotes} PTM note(s) · Page ${i} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 24)
  }
  doc.save(fileName(r, 'pdf'))
}
