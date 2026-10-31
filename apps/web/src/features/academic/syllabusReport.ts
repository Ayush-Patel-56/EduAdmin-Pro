import cssHref from './syllabusReport.css?url'
import { STATUS_LABELS, type SyllabusItem } from './api'

type Report = { schoolName: string; program: string; batch: string; subject: string; items: SyllabusItem[] }

const escape = (text: string | number | null) =>
  String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The report page. Styles come from `cssUrl`; bar widths are set after writing (see printReport). */
export function reportHtml({ schoolName, program, batch, subject, items }: Report, cssUrl: string) {
  const bySubject = new Map<string, SyllabusItem[]>()
  for (const item of items) bySubject.set(item.subject, [...(bySubject.get(item.subject) ?? []), item])
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  const sections = [...bySubject.entries()]
    .map(([name, rows]) => {
      const done = rows.filter((r) => r.status === 'COMPLETED').length
      const pct = Math.round((done / rows.length) * 100)
      return `
      <section>
        <div class="subject"><h2>${escape(name)}</h2><span>${done}/${rows.length} completed · ${pct}%</span></div>
        <div class="bar"><div data-pct="${pct}"></div></div>
        <table>
          <thead><tr><th>#</th><th>Chapter</th><th>Est. hours</th><th>Target dates</th><th>Status</th><th>Remarks</th></tr></thead>
          <tbody>${rows
            .map((r, i) => {
              return `<tr><td>${i + 1}</td><td>${escape(r.title)}</td><td>${escape(r.estimatedHours)}</td><td>${escape(
                r.targetDates,
              )}</td><td><span class="pill ${r.status}">${STATUS_LABELS[r.status]}</span></td><td>${escape(
                r.remarks,
              )}</td></tr>`
            })
            .join('')}</tbody>
        </table>
      </section>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Syllabus — ${escape(batch)}</title>
  <link rel="stylesheet" href="${escape(cssUrl)}"></head><body>
  <header><h1>Syllabus Coverage Report</h1><p>${escape(schoolName)} · ${escape(program)} · ${escape(batch)} · ${escape(subject)}</p></header>
  ${sections || '<p class="empty">No chapters recorded yet.</p>'}
  <footer>Generated ${escape(generated)} by EduAdmin Pro</footer>
  </body></html>`
}

/** Renders the report in a hidden frame and opens the print dialog (Save as PDF). */
export function printReport(report: Report) {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.setAttribute('aria-hidden', 'true')
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(reportHtml(report, cssHref))
  doc.close()
  // Through the DOM, which the Content-Security-Policy allows (style="" in the markup it doesn't).
  for (const bar of doc.querySelectorAll<HTMLElement>('.bar div')) bar.style.width = `${bar.dataset.pct}%`
  const print = () => {
    frame.contentWindow!.focus()
    frame.contentWindow!.print()
    setTimeout(() => frame.remove(), 1000)
  }
  // Print once the stylesheet has loaded (or failed), not before.
  const sheet = doc.querySelector('link[rel=stylesheet]')
  if (sheet) {
    sheet.addEventListener('load', print, { once: true })
    sheet.addEventListener('error', print, { once: true })
  } else {
    setTimeout(print, 100)
  }
}
