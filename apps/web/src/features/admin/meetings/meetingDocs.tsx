import { useEffect, useState, type ReactNode } from 'react'
import { Download, Eye, X } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { dmy, PRIORITY_LABELS, PRIORITY_STYLE, STATUS_LABELS, STATUS_STYLE, TYPE_LABELS, type Meeting } from '@/features/meetings/api'

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meeting'
const dash = (v: string | null | undefined) => v || '—'

/** The line the agenda paper ends with. */
const AGENDA_NOTE = 'All attendees are required to be present in the venue at the time of meeting without fail'

/** Agenda Preview / Minutes Preview: the meeting as a paper, from what is recorded, with a PDF download. */
export function MeetingDocDialog({ meeting, kind, onClose }: { meeting: Meeting; kind: 'agenda' | 'minutes'; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  async function download() {
    setBusy(true)
    setError(null)
    try {
      await (kind === 'agenda' ? agendaPdf(meeting) : minutesPdf(meeting))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the PDF')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={kind === 'agenda' ? 'Agenda Preview' : 'Minutes Preview'}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><Eye className="size-4 text-emerald-600" /> {kind === 'agenda' ? 'Agenda Preview' : 'Minutes Preview'}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void download()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
              <Download className="size-4" /> {busy ? 'Creating…' : 'Download PDF'}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700"><X className="size-5" /></button>
          </div>
        </div>
        {error && <div className="px-5 pt-3"><ErrorBanner message={error} /></div>}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-6">
          <article className="mx-auto min-h-[60vh] max-w-2xl bg-white px-10 py-12 text-slate-900 shadow-sm">
            {kind === 'agenda' ? <AgendaPaper meeting={meeting} /> : <MinutesPaper meeting={meeting} />}
          </article>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold">{label}</p>
      <p className="text-xs text-slate-600">{children}</p>
    </div>
  )
}

function AgendaPaper({ meeting: m }: { meeting: Meeting }) {
  return (
    <>
      <h1 className="text-center text-2xl font-bold">Agenda for the Meeting on {dmy(m.date)}</h1>
      <hr className="mt-5 border-t-[3px] border-indigo-600" />
      <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-3">
        <Fact label="Date Of Meeting">{dmy(m.date)}{m.time ? `, ${m.time}` : ''}</Fact>
        <Fact label="Attendees">{dash(m.attendees.join(', '))}</Fact>
        <Fact label="Nature Of Meeting">{TYPE_LABELS[m.type]}</Fact>
        <Fact label="Venue">{dash(m.venue)}</Fact>
      </div>
      <hr className="mt-6 border-slate-300" />
      <h2 className="mt-5 text-sm font-bold text-indigo-600">Agenda for the Meeting</h2>
      {m.agendaItems.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400 italic">No agenda items yet.</p>
      ) : (
        <ol className="mt-3 list-decimal space-y-1 pl-10 text-xs font-semibold">
          {m.agendaItems.map((a) => <li key={a.id}>{a.title}</li>)}
        </ol>
      )}
      <p className="mt-10 text-[11px] text-slate-600">{AGENDA_NOTE}</p>
    </>
  )
}

function MinutesPaper({ meeting: m }: { meeting: Meeting }) {
  return (
    <>
      <h1 className="text-center text-2xl font-bold">Minutes of The Meeting</h1>
      <div className="mt-5 grid grid-cols-3 gap-x-6 gap-y-3">
        <Fact label="Date Of Meeting">{dmy(m.date)}</Fact>
        <Fact label="Nature Of Meeting">{TYPE_LABELS[m.type]}</Fact>
        <Fact label="Attendees">{dash(m.attendees.join(', '))}</Fact>
        <Fact label="Time Of Meeting">{dash(m.time)}</Fact>
        <Fact label="Venue Of Meeting">{dash(m.venue)}</Fact>
        <div />
        <Fact label="Minutes Prepared By">{dash(m.minutesPreparedBy)}</Fact>
        <Fact label="Next Meeting Date">{dash(dmy(m.nextMeetingDate))}</Fact>
      </div>
      <hr className="mt-5 border-t-[3px] border-indigo-600" />
      {m.agendaItems.length === 0 ? (
        <p className="mt-5 text-xs text-slate-400 italic">No agenda items recorded.</p>
      ) : (
        m.agendaItems.map((a, i) => (
          <section key={a.id} className="mt-6 space-y-3 border-b border-slate-100 pb-5 last:border-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold">Agenda</p>
                <p className="text-sm font-bold"><span className="text-indigo-600">{i + 1}.</span> {a.title}</p>
              </div>
              <div className="flex gap-1.5 text-[10px] font-semibold">
                <span className={`rounded-full border px-2 py-0.5 ${STATUS_STYLE[a.status]}`}>{STATUS_LABELS[a.status]}</span>
                <span className={`rounded-full border px-2 py-0.5 ${PRIORITY_STYLE[a.priority]}`}>{PRIORITY_LABELS[a.priority]} Priority</span>
              </div>
            </div>
            <Fact label="Discussion"><span className="whitespace-pre-line">{dash(a.discussion)}</span></Fact>
            <Fact label="Action to be taken"><span className="whitespace-pre-line">{dash(a.action)}</span></Fact>
            <div className="grid grid-cols-2 gap-3">
              <Fact label="Person Responsible">{dash(a.responsible)}</Fact>
              <Fact label="Target Date">{dash(dmy(a.targetDate))}</Fact>
              <Fact label="To be Communicated to">{dash(a.communicatedTo)}</Fact>
              <Fact label="To be Communicated by">{dash(a.communicatedBy)}</Fact>
            </div>
          </section>
        ))
      )}
    </>
  )
}

// PDFs are drawn as text (selectable, small), mirroring the previews.

type Doc = import('jspdf').jsPDF
const MARGIN = 50

async function newDoc() {
  const { jsPDF } = await import('jspdf')
  return new jsPDF({ unit: 'pt', format: 'a4' })
}

/** Writes wrapped text and returns the next y, starting a new page when needed. */
function write(doc: Doc, text: string, y: number, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; width?: number } = {}) {
  const width = opts.width ?? doc.internal.pageSize.getWidth() - MARGIN * 2
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
  doc.setFontSize(opts.size ?? 10)
  doc.setTextColor(...(opts.color ?? [15, 23, 42]))
  const lines = doc.splitTextToSize(text, width) as string[]
  const lineHeight = (opts.size ?? 10) * 1.35
  for (const line of lines) {
    if (y > doc.internal.pageSize.getHeight() - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
    doc.text(line, opts.x ?? MARGIN, y)
    y += lineHeight
  }
  return y
}

function facts(doc: Doc, pairs: [string, string][], y: number, columns: number) {
  const width = (doc.internal.pageSize.getWidth() - MARGIN * 2) / columns
  for (let i = 0; i < pairs.length; i += columns) {
    let next = y
    pairs.slice(i, i + columns).forEach(([label, value], c) => {
      const x = MARGIN + c * width
      write(doc, label, y, { bold: true, size: 9, x, width: width - 10 })
      next = Math.max(next, write(doc, value, y + 12, { size: 9, color: [71, 85, 105], x, width: width - 10 }))
    })
    y = next + 6
  }
  return y
}

function rule(doc: Doc, y: number, thick: boolean) {
  doc.setDrawColor(...((thick ? [79, 70, 229] : [203, 213, 225]) as [number, number, number]))
  doc.setLineWidth(thick ? 2 : 0.7)
  doc.line(MARGIN, y, doc.internal.pageSize.getWidth() - MARGIN, y)
  return y + 16
}

async function agendaPdf(m: Meeting) {
  const doc = await newDoc()
  const center = doc.internal.pageSize.getWidth() / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(`Agenda for the Meeting on ${dmy(m.date)}`, center, 70, { align: 'center' })
  let y = rule(doc, 86, true)
  y = facts(doc, [
    ['Date Of Meeting', `${dmy(m.date)}${m.time ? `, ${m.time}` : ''}`],
    ['Attendees', dash(m.attendees.join(', '))],
    ['Nature Of Meeting', TYPE_LABELS[m.type]],
    ['Venue', dash(m.venue)],
  ], y, 2)
  y = rule(doc, y + 4, false)
  y = write(doc, 'Agenda for the Meeting', y, { bold: true, size: 11, color: [79, 70, 229] }) + 4
  if (m.agendaItems.length === 0) y = write(doc, 'No agenda items yet.', y, { size: 9, color: [148, 163, 184] })
  m.agendaItems.forEach((a, i) => {
    y = write(doc, `${i + 1}. ${a.title}`, y, { bold: true, size: 10, x: MARGIN + 20 })
  })
  write(doc, AGENDA_NOTE, y + 24, { size: 8, color: [71, 85, 105] })
  doc.save(`agenda-${slug(m.title)}-${m.date}.pdf`)
}

async function minutesPdf(m: Meeting) {
  const doc = await newDoc()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Minutes of The Meeting', doc.internal.pageSize.getWidth() / 2, 70, { align: 'center' })
  let y = facts(doc, [
    ['Date Of Meeting', dmy(m.date)!],
    ['Nature Of Meeting', TYPE_LABELS[m.type]],
    ['Attendees', dash(m.attendees.join(', '))],
    ['Time Of Meeting', dash(m.time)],
    ['Venue Of Meeting', dash(m.venue)],
    ['', ''],
    ['Minutes Prepared By', dash(m.minutesPreparedBy)],
    ['Next Meeting Date', dash(dmy(m.nextMeetingDate))],
  ], 96, 3)
  y = rule(doc, y, true)
  if (m.agendaItems.length === 0) write(doc, 'No agenda items recorded.', y, { size: 9, color: [148, 163, 184] })
  m.agendaItems.forEach((a, i) => {
    y = write(doc, 'Agenda', y, { bold: true, size: 9 })
    y = write(doc, `${i + 1}. ${a.title}   [${STATUS_LABELS[a.status]} · ${PRIORITY_LABELS[a.priority]} Priority]`, y, { bold: true, size: 11 }) + 4
    y = facts(doc, [['Discussion', dash(a.discussion)]], y, 1)
    y = facts(doc, [['Action to be taken', dash(a.action)]], y, 1)
    y = facts(doc, [
      ['Person Responsible', dash(a.responsible)],
      ['Target Date', dash(dmy(a.targetDate))],
      ['To be Communicated to', dash(a.communicatedTo)],
      ['To be Communicated by', dash(a.communicatedBy)],
    ], y, 2)
    y = rule(doc, y + 4, false)
  })
  doc.save(`minutes-${slug(m.title)}-${m.date}.pdf`)
}
