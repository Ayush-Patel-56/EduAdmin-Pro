import { STATUS_LABELS, type SyllabusItem } from './api'

type Report = { schoolName: string; program: string; batch: string; subject: string; items: SyllabusItem[] }

const escape = (text: string | number | null) =>
  String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const STATUS_COLORS = {
  NOT_STARTED: ['#f1f5f9', '#475569'],
  IN_PROGRESS: ['#eef2ff', '#4338ca'],
  COMPLETED: ['#ecfdf5', '#047857'],
} as const

function reportHtml({ schoolName, program, batch, subject, items }: Report) {
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
        <div class="bar"><div style="width:${pct}%"></div></div>
        <table>
          <thead><tr><th>#</th><th>Chapter</th><th>Est. hours</th><th>Target dates</th><th>Status</th><th>Remarks</th></tr></thead>
          <tbody>${rows
            .map((r, i) => {
              const [bg, fg] = STATUS_COLORS[r.status]
              return `<tr><td>${i + 1}</td><td>${escape(r.title)}</td><td>${escape(r.estimatedHours)}</td><td>${escape(
                r.targetDates,
              )}</td><td><span class="pill" style="background:${bg};color:${fg}">${STATUS_LABELS[r.status]}</span></td><td>${escape(
                r.remarks,
              )}</td></tr>`
            })
            .join('')}</tbody>
        </table>
      </section>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Syllabus — ${escape(batch)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #0f172a; margin: 32px; }
    header { background: linear-gradient(135deg, #4f46e5, #059669); color: white; border-radius: 14px; padding: 20px 24px; }
    header h1 { margin: 0 0 4px; font-size: 22px; }
    header p { margin: 0; opacity: .9; font-size: 13px; }
    section { margin-top: 24px; break-inside: avoid; }
    .subject { display: flex; justify-content: space-between; align-items: baseline; }
    .subject h2 { margin: 0; font-size: 16px; }
    .subject span { font-size: 12px; color: #475569; }
    .bar { height: 8px; background: #e2e8f0; border-radius: 99px; margin: 8px 0 10px; overflow: hidden; }
    .bar div { height: 100%; background: #10b981; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; background: #f8fafc; color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    th, td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .pill { padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; white-space: nowrap; }
    .empty { margin-top: 24px; color: #64748b; }
    footer { margin-top: 28px; font-size: 10px; color: #94a3b8; }
    @media print { body { margin: 12mm; } header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .bar div, .pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
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
  doc.write(reportHtml(report))
  doc.close()
  frame.contentWindow!.focus()
  setTimeout(() => {
    frame.contentWindow!.print()
    setTimeout(() => frame.remove(), 1000)
  }, 100)
}
