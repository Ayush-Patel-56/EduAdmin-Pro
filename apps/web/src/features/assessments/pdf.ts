import { answerLabel, DIFFICULTY_LABELS, LETTERS, type QuestionType } from './api'

/** Larger files are refused before reading (a question bank PDF is a few hundred KB). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024
/** The API reads at most this much text from one file. */
export const MAX_PDF_TEXT = 500_000

type TextItem = { str: string; transform: number[]; height: number; hasEOL?: boolean }

/**
 * A page's text items as lines: pdf.js gives runs of text with their position;
 * a new line starts at an end-of-line mark or when the baseline moves.
 */
export function linesOf(items: unknown[]): string {
  let out = ''
  let lastY: number | null = null
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue
    const it = raw as TextItem
    const y = it.transform[5]
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, it.height * 0.5) && out && !out.endsWith('\n')) out += '\n'
    out += it.str
    if (it.hasEOL) out += '\n'
    if (it.str.trim() || it.hasEOL) lastY = y
  }
  return out.replace(/[ \t]+\n/g, '\n')
}

/** The selectable text of a PDF, page by page. Throws a message for a file it can't use. */
export async function readPdfText(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a PDF file')
  if (file.size > MAX_PDF_BYTES) throw new Error('The PDF is larger than 10 MB')
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  let doc
  try {
    doc = await task.promise
  } catch {
    void task.destroy()
    throw new Error("This PDF couldn't be opened. Check it isn't password-protected or damaged.")
  }
  try {
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      pages.push(linesOf((await page.getTextContent()).items))
    }
    const text = pages.join('\n').trim()
    if (!text) throw new Error('This PDF has no selectable text (it may be a scan). Upload a PDF made from a typed document.')
    if (text.length > MAX_PDF_TEXT) throw new Error('This PDF has too much text for one upload. Split it into smaller files.')
    return text
  } finally {
    void task.destroy()
  }
}

export type PaperItem = { text: string; type: QuestionType; options: string[]; correctAnswer: string | null; marks: number; negativeMarks: number; difficulty?: keyof typeof DIFFICULTY_LABELS; topic?: string }

export type PaperHeader = { institute: string; title: string; subject: string; date: string; duration: string; totalMarks: string; instructions: string }

/** A question paper as an A4 PDF: header, numbered questions with their options, and an answer key if asked. */
export async function paperPdf(header: PaperHeader, items: PaperItem[], opts: { showMarks: boolean; answerKey: boolean }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const margin = 48
  const usable = width - margin * 2
  let y = margin
  const need = (h: number) => {
    if (y + h > height - margin) {
      doc.addPage()
      y = margin
    }
  }
  const write = (text: string, size: number, opt: { bold?: boolean; indent?: number; color?: number; center?: boolean; gap?: number } = {}) => {
    doc.setFont('helvetica', opt.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(opt.color ?? 20)
    const lines = doc.splitTextToSize(text, usable - (opt.indent ?? 0)) as string[]
    for (const line of lines) {
      need(size * 1.35)
      doc.text(line, opt.center ? width / 2 : margin + (opt.indent ?? 0), y, opt.center ? { align: 'center' } : undefined)
      y += size * 1.35
    }
    y += opt.gap ?? 0
  }

  if (header.institute.trim()) write(header.institute.trim(), 16, { bold: true, center: true })
  write(header.title.trim(), 13, { bold: true, center: true, gap: 4 })
  const meta = [header.subject && `Subject: ${header.subject}`, header.date && `Date: ${header.date}`, header.duration && `Duration: ${header.duration}`, header.totalMarks && `Max. Marks: ${header.totalMarks}`].filter(Boolean).join('     ')
  if (meta) write(meta, 9.5, { center: true, color: 80 })
  y += 6
  doc.setDrawColor(180)
  doc.line(margin, y, width - margin, y)
  y += 16
  if (header.instructions.trim()) {
    write('Instructions', 10, { bold: true })
    write(header.instructions.trim(), 9.5, { color: 60, gap: 10 })
  }

  items.forEach((q, i) => {
    need(40)
    const marks = opts.showMarks ? `  [${q.marks} mark${q.marks === 1 ? '' : 's'}${q.negativeMarks ? `, -${q.negativeMarks}` : ''}]` : ''
    write(`${i + 1}. ${q.text}${marks}`, 10.5, { gap: 2 })
    if (q.type === 'MCQ') {
      q.options.forEach((o, j) => write(`(${LETTERS[j]}) ${o}`, 10, { indent: 18 }))
    } else if (q.type === 'SUBJECTIVE') {
      y += 36
    } else {
      write('Answer: ____________', 10, { indent: 18, color: 90 })
    }
    y += 10
  })

  if (opts.answerKey && items.length) {
    doc.addPage()
    y = margin
    write('Answer Key', 13, { bold: true, gap: 6 })
    items.forEach((q, i) => write(`${i + 1}. ${q.type === 'SUBJECTIVE' ? (q.correctAnswer ?? 'Teacher-graded') : answerLabel(q)}`, 10))
  }
  return doc
}

/** The Upload PDF sample (MCQ), as a PDF in the exact format the upload reads. */
export async function sampleTemplatePdf() {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const lines = [
    'Subject: Physics',
    'Topic: Thermodynamics',
    'Difficulty: Medium',
    'Type: MCQ',
    'Marks: 4',
    'Negative Marks: -1',
    'Source: Custom',
    '',
    '1. What is the SI unit of temperature?',
    '(A) Celsius',
    '(B) Kelvin',
    '(C) Fahrenheit',
    '(D) Rankine',
    '',
    '2. Which process occurs at constant temperature?',
    '(A) Adiabatic',
    '(B) Isochoric',
    '(C) Isothermal',
    '(D) Isobaric',
    '',
    'ANSWER KEY',
    '1. B',
    '2. C',
  ]
  doc.setFont('courier', 'normal')
  doc.setFontSize(11)
  lines.forEach((line, i) => doc.text(line, 56, 64 + i * 18))
  return doc
}
