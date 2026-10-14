import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Ban, Plus, Receipt } from 'lucide-react'
import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import type { Structure } from '@/features/academic/api'
import { formatDay } from '@/features/portal/format'
import { StudentPicker, type PickedStudent } from '@/features/students/StudentPicker'
import {
  CATEGORY_LABELS,
  currentAcademicYear,
  dueDateIn,
  feesPath,
  FREQUENCY_LABELS,
  inr,
  METHOD_LABELS,
  periodLabel,
  STATUS_LABELS,
  STATUS_STYLE,
  toPaise,
  type Due,
  type FeeCategory,
  type FeeFrequency,
  type FeeStatus,
  type FeeStructure,
  type PaymentMethod,
  type StructureOption,
} from '@/features/fees/api'

const label = 'mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase'
const field =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500'
const area = `${field.replace('h-10 ', '')} resize-y py-2.5`
const box = 'rounded-xl border border-slate-200 bg-slate-50/70 p-4'

function F({ id, text, children, className }: { id: string; text: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
    </div>
  )
}

function Footer({ busy, text, onClose }: { busy: boolean; text: string; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
      <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
      <button type="submit" disabled={busy} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
        {busy ? 'Saving…' : text}
      </button>
    </div>
  )
}

const rupeesText = (paise: number) => (paise ? String(paise / 100) : '')
const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

// Fee structures

type StructureProps = {
  schoolId: string
  structure?: FeeStructure
  academic: Structure | undefined
  yearStartMonth: number
  onSaved: () => Promise<unknown>
  onClose: () => void
}

/** Create New Fee Structure / Edit Fee Structure. */
export function StructureDialog({ schoolId, structure, academic, yearStartMonth, onSaved, onClose }: StructureProps) {
  const [v, setV] = useState({
    category: (structure?.category ?? 'MONTHLY_TUITION') as FeeCategory,
    name: structure?.name ?? '',
    description: structure?.description ?? '',
    amount: structure ? rupeesText(structure.amountPaise) : '',
    frequency: (structure?.frequency ?? 'MONTHLY') as FeeFrequency,
    dueDay: String(structure?.dueDay ?? 5),
    mandatory: structure?.mandatory ?? true,
    programId: structure?.program?.id ?? '',
    batchId: structure?.batch?.id ?? '',
    academicYear: structure?.academicYear ?? currentAcademicYear(todayIst(), yearStartMonth),
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((p) => ({ ...p, [key]: value }))
    setError(null)
  }
  const batches = (academic?.batches ?? []).filter((b) => !v.programId || b.programId === v.programId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.name.trim()) return setError('Fee structure name is required')
    const amount = toPaise(v.amount)
    if (amount === null || !v.amount.trim()) return setError('Enter the amount in rupees, like 12500')
    const dueDay = Number(v.dueDay)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return setError('Due day must be a day of the month (1-31)')
    if (!/^\d{4}-\d{2}$/.test(v.academicYear)) return setError('Academic year must look like 2026-27')
    setBusy(true)
    try {
      const body = { ...v, amount: amount / 100, dueDay, programId: v.programId || null, batchId: v.batchId || null }
      await api(structure ? `${feesPath(schoolId)}/structures/${structure.id}` : `${feesPath(schoolId)}/structures`, {
        method: structure ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(message(err, 'Could not save the fee structure'))
      setBusy(false)
    }
  }

  return (
    <Dialog title={structure ? 'Edit Fee Structure' : 'Create New Fee Structure'} description="Configure financial details, recurring rules, and batch associations" onClose={onClose} widthClass="max-w-2xl">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <F id="fs-category" text="Fee Category Type *">
              <select id="fs-category" value={v.category} onChange={(e) => set('category', e.target.value as FeeCategory)} className={field}>
                {(Object.keys(CATEGORY_LABELS) as FeeCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </F>
            <F id="fs-name" text="Fee Structure Name *">
              <input id="fs-name" maxLength={120} value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Tuition Fee - Core JEE" className={field} />
            </F>
          </div>
          <F id="fs-desc" text="Description">
            <input id="fs-desc" maxLength={500} value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Comprehensive curriculum and digital portal fees" className={field} />
          </F>
          <section className={box}>
            <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-700 uppercase">Financial Details</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <F id="fs-amount" text="Amount (₹) *"><input id="fs-amount" inputMode="decimal" value={v.amount} onChange={(e) => set('amount', e.target.value)} placeholder="12500" className={field} /></F>
              <F id="fs-frequency" text="Frequency *">
                <select id="fs-frequency" value={v.frequency} onChange={(e) => set('frequency', e.target.value as FeeFrequency)} className={field}>
                  {(Object.keys(FREQUENCY_LABELS) as FeeFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
                </select>
              </F>
              <F id="fs-day" text="Due Day (1-31) *"><input id="fs-day" inputMode="numeric" value={v.dueDay} onChange={(e) => set('dueDay', e.target.value)} className={field} /></F>
            </div>
            <label className="mt-4 flex items-start gap-2.5 text-sm font-semibold text-slate-800">
              <input type="checkbox" checked={v.mandatory} onChange={(e) => set('mandatory', e.target.checked)} className="mt-0.5 size-4 accent-indigo-600" />
              <span>
                Mandatory Fee
                <span className="block text-xs font-normal text-slate-500">Charged to every active student it applies to when you use Assess Dues. An optional fee is recorded per student.</span>
              </span>
            </label>
          </section>
          <section className={box}>
            <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-700 uppercase">Scope &amp; Association</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <F id="fs-program" text="Program Association">
                <select id="fs-program" value={v.programId} onChange={(e) => setV((p) => ({ ...p, programId: e.target.value, batchId: academic?.batches.some((b) => b.id === p.batchId && b.programId === e.target.value) ? p.batchId : '' }))} className={field}>
                  <option value="">All Programs</option>
                  {(academic?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </F>
              <F id="fs-batch" text="Batch Association">
                <select id="fs-batch" value={v.batchId} onChange={(e) => set('batchId', e.target.value)} className={field}>
                  <option value="">All Batches</option>
                  {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </F>
              <F id="fs-year" text="Academic Year"><input id="fs-year" value={v.academicYear} onChange={(e) => set('academicYear', e.target.value)} placeholder="2026-27" className={field} /></F>
            </div>
          </section>
          {structure && structure.dueCount > 0 && (
            <p className="text-xs text-slate-500">Changes apply to dues assessed from now on; the {structure.dueCount} existing due{structure.dueCount === 1 ? '' : 's'} keep their amounts.</p>
          )}
          <ErrorBanner message={error} />
        </div>
        <Footer busy={busy} text={structure ? 'Save Changes' : 'Create Fee Structure'} onClose={onClose} />
      </form>
    </Dialog>
  )
}

/** Assess Dues: charge a mandatory fee to every active student it applies to, for one billing month. */
export function AssessDialog({ schoolId, structure, onSaved, onClose }: { schoolId: string; structure: FeeStructure; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [month, setMonth] = useState(todayIst().slice(0, 7))
  const [result, setResult] = useState<{ created: number; alreadyAssessed: number; dueDate: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!month) return setError('Pick the billing month')
    setBusy(true)
    setError(null)
    try {
      setResult(await api(`${feesPath(schoolId)}/structures/${structure.id}/assess`, { method: 'POST', body: JSON.stringify({ month }) }))
      await onSaved()
    } catch (err) {
      setError(message(err, 'Could not assess the fee'))
    } finally {
      setBusy(false)
    }
  }

  const scope = structure.batch?.name ?? (structure.program ? `the ${structure.program.name} program` : 'the whole school')
  return (
    <Dialog title="Assess Dues" description={`${structure.name} · ${inr(structure.amountPaise)} ${FREQUENCY_LABELS[structure.frequency].toLowerCase()}`} onClose={onClose} widthClass="max-w-md">
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-slate-600">
            Every active student in {scope} gets a due for this fee, due on day {structure.dueDay} of the month. Students who already have it for that period are left as they are.
          </p>
          <F id="as-month" text="Billing Month *"><input id="as-month" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setResult(null) }} className={field} /></F>
          {result && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              {result.created} due{result.created === 1 ? '' : 's'} created (due {formatDay(result.dueDate)}){result.alreadyAssessed ? `; ${result.alreadyAssessed} student${result.alreadyAssessed === 1 ? '' : 's'} already had it` : ''}.
            </p>
          )}
          <ErrorBanner message={error} />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">{result ? 'Done' : 'Cancel'}</button>
          <button type="submit" disabled={busy} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">{busy ? 'Assessing…' : 'Assess Dues'}</button>
        </div>
      </form>
    </Dialog>
  )
}

// Payments

type Figures = { amountDue: string; discount: string; lateFee: string; dueDate: string; statusOverride: FeeStatus | ''; overrideReason: string; notes: string }
type PaymentForm = { amountPaid: string; method: PaymentMethod | ''; receiptNumber: string; transactionRef: string; paidOn: string }

function FiguresFields({ v, set, lockAmount }: { v: Figures; set: (patch: Partial<Figures>) => void; lockAmount?: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-4">
        <F id="fd-due" text="Amount Due (₹)"><input id="fd-due" inputMode="decimal" value={v.amountDue} disabled={lockAmount} onChange={(e) => set({ amountDue: e.target.value })} className={field} /></F>
        <F id="fd-discount" text="Discount (₹)"><input id="fd-discount" inputMode="decimal" value={v.discount} onChange={(e) => set({ discount: e.target.value })} placeholder="0" className={field} /></F>
        <F id="fd-late" text="Late Fee (₹)"><input id="fd-late" inputMode="decimal" value={v.lateFee} onChange={(e) => set({ lateFee: e.target.value })} placeholder="0" className={field} /></F>
        <F id="fd-date" text="Due Date *"><input id="fd-date" type="date" value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={field} /></F>
      </div>
      {lockAmount && <p className="text-[11px] text-slate-500">The amount due is fixed once a payment is recorded; adjust it with a discount or late fee.</p>}
    </>
  )
}

function OverrideFields({ v, set }: { v: Figures; set: (patch: Partial<Figures>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <F id="fd-status" text="Status Override">
        <select id="fd-status" value={v.statusOverride} onChange={(e) => set({ statusOverride: e.target.value as FeeStatus | '' })} className={field}>
          <option value="">Automatic (from the amounts and due date)</option>
          {(Object.keys(STATUS_LABELS) as FeeStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </F>
      {v.statusOverride ? (
        <F id="fd-reason" text="Reason for Override *"><input id="fd-reason" maxLength={300} value={v.overrideReason} onChange={(e) => set({ overrideReason: e.target.value })} placeholder="e.g. Merit scholarship 2026" className={field} /></F>
      ) : <div />}
      <F id="fd-notes" text="Notes" className="sm:col-span-2"><textarea id="fd-notes" rows={2} maxLength={1000} value={v.notes} onChange={(e) => set({ notes: e.target.value })} className={area} /></F>
    </div>
  )
}

function PaymentFields({ v, set, required }: { v: PaymentForm; set: (patch: Partial<PaymentForm>) => void; required: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <F id="pf-paid" text={required ? 'Amount Paid (₹) *' : 'Amount Paid (₹)'}><input id="pf-paid" inputMode="decimal" value={v.amountPaid} onChange={(e) => set({ amountPaid: e.target.value })} placeholder="0" className={field} /></F>
      <F id="pf-method" text="Payment Method *">
        <select id="pf-method" value={v.method} onChange={(e) => set({ method: e.target.value as PaymentMethod })} className={field}>
          <option value="">Select method...</option>
          {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
        </select>
      </F>
      <F id="pf-date" text="Paid Date"><input id="pf-date" type="date" value={v.paidOn} max={todayIst()} onChange={(e) => set({ paidOn: e.target.value })} className={field} /></F>
      <F id="pf-receipt" text="Receipt Number"><input id="pf-receipt" maxLength={40} value={v.receiptNumber} onChange={(e) => set({ receiptNumber: e.target.value })} placeholder={`Auto: REC-${todayIst().slice(0, 4)}-…`} className={field} /></F>
      <F id="pf-ref" text="Transaction / Ref ID" className="sm:col-span-2"><input id="pf-ref" maxLength={80} value={v.transactionRef} onChange={(e) => set({ transactionRef: e.target.value })} placeholder="UPI reference, cheque number…" className={field} /></F>
    </div>
  )
}

/** Checks the money fields; returns the JSON body parts or an error. */
function readFigures(v: Figures) {
  const amountDue = toPaise(v.amountDue)
  const discount = toPaise(v.discount)
  const lateFee = toPaise(v.lateFee)
  if (amountDue === null || discount === null || lateFee === null) return { error: 'Amounts must be in rupees, like 12500 or 12500.50' }
  if (!v.dueDate) return { error: 'Due date is required' }
  if (discount > amountDue + lateFee) return { error: 'The discount can’t be more than the amount due plus the late fee' }
  if (v.statusOverride && !v.overrideReason.trim()) return { error: 'Give a reason for overriding the status' }
  return {
    body: {
      amountDue: amountDue / 100,
      discount: discount / 100,
      lateFee: lateFee / 100,
      dueDate: v.dueDate,
      statusOverride: v.statusOverride || null,
      overrideReason: v.statusOverride ? v.overrideReason : null,
      notes: v.notes,
    },
    net: amountDue - discount + lateFee,
  }
}

function readPayment(v: PaymentForm, required: boolean) {
  const paid = toPaise(v.amountPaid)
  if (paid === null) return { error: 'Amount paid must be in rupees, like 5000' }
  if (required && paid <= 0) return { error: 'Enter the amount paid' }
  if (paid > 0 && !v.method) return { error: 'Select the payment method' }
  return {
    paid,
    body: { amountPaid: paid / 100, method: v.method || undefined, receiptNumber: v.receiptNumber, transactionRef: v.transactionRef, paidOn: v.paidOn },
  }
}

const emptyPayment = (): PaymentForm => ({ amountPaid: '', method: '', receiptNumber: '', transactionRef: '', paidOn: todayIst() })

/** Record Payment Transaction: a student's fee for a period, and what they paid. */
export function RecordPaymentDialog({
  schoolId,
  structures,
  onSaved,
  onClose,
}: {
  schoolId: string
  structures: StructureOption[]
  onSaved: () => Promise<unknown>
  onClose: () => void
}) {
  // One key per dialog: a retried or double-clicked submit records the payment once.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [structureId, setStructureId] = useState('')
  const [f, setF] = useState<Figures>({ amountDue: '', discount: '', lateFee: '', dueDate: todayIst(), statusOverride: '', overrideReason: '', notes: '' })
  const [p, setP] = useState<PaymentForm>(emptyPayment)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const figures = useMemo(() => readFigures(f), [f])

  function pickStructure(id: string) {
    setStructureId(id)
    const s = structures.find((x) => x.id === id)
    if (s) setF((prev) => ({ ...prev, amountDue: rupeesText(s.amountPaise), dueDate: dueDateIn(todayIst().slice(0, 7), s.dueDay) }))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!student) return setError('Select a student')
    if (!structureId) return setError('Select a fee structure')
    if ('error' in figures) return setError(figures.error ?? null)
    const pay = readPayment(p, false)
    if ('error' in pay) return setError(pay.error ?? null)
    if (pay.paid > figures.net) return setError(`That's more than the ${inr(figures.net)} net payable`)
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ receiptNumber?: string; created: boolean }>(`${feesPath(schoolId)}/dues`, {
        method: 'POST',
        body: JSON.stringify({ studentId: student.id, structureId, ...figures.body, ...pay.body, idempotencyKey }),
      })
      await onSaved()
      setSaved(result.receiptNumber ? `Payment recorded · receipt ${result.receiptNumber}` : 'Due saved')
    } catch (err) {
      setError(message(err, 'Could not record the payment'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Record Payment Transaction" description="A student’s fee for one period and what they paid (recorded, not collected online)" onClose={onClose} widthClass="max-w-3xl">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <F id="rp-student" text="Student *">
              <StudentPicker id="rp-student" portal={{ kind: 'admin', schoolId }} value={student} onChange={setStudent} />
            </F>
            <F id="rp-structure" text="Fee Structure *">
              <select id="rp-structure" value={structureId} onChange={(e) => pickStructure(e.target.value)} className={field}>
                <option value="">{structures.length ? 'Select a fee structure...' : 'Create a fee structure first'}</option>
                {structures.map((s) => <option key={s.id} value={s.id}>{s.name} ({inr(s.amountPaise)} {FREQUENCY_LABELS[s.frequency].toLowerCase()})</option>)}
              </select>
            </F>
          </div>
          <section className={box}>
            <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-700 uppercase">Financial Breakdown</p>
            <FiguresFields v={f} set={(patch) => { setF((prev) => ({ ...prev, ...patch })); setError(null) }} />
            <p className="mt-3 text-sm text-slate-700">
              Net Payable: <strong className="text-slate-900">{figures.net !== undefined ? inr(figures.net) : '—'}</strong>
              <span className="ml-1 text-xs text-slate-500">(amount due − discount + late fee)</span>
            </p>
          </section>
          <section className={box}>
            <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-700 uppercase">Payment</p>
            <PaymentFields v={p} set={(patch) => { setP((prev) => ({ ...prev, ...patch })); setError(null) }} required={false} />
            <p className="mt-2 text-[11px] text-slate-500">Leave Amount Paid at 0 to record the due without a payment. If the student already has this fee for that period, the payment is added to it.</p>
          </section>
          <OverrideFields v={f} set={(patch) => { setF((prev) => ({ ...prev, ...patch })); setError(null) }} />
          {saved && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800">{saved}</p>}
          <ErrorBanner message={error} />
        </div>
        {saved ? (
          <div className="flex justify-end border-t border-slate-100 px-6 py-4">
            <button type="button" onClick={onClose} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover">Done</button>
          </div>
        ) : (
          <Footer busy={busy} text="Record Payment" onClose={onClose} />
        )}
      </form>
    </Dialog>
  )
}

/** One student's due: its payments (each can be voided), adding a payment, and editing the due. */
export function DueDialog({ schoolId, due, onSaved, onClose }: { schoolId: string; due: Due; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'pay' | 'edit'>('view')
  const [paymentKey] = useState(() => crypto.randomUUID())
  const [p, setP] = useState<PaymentForm>(emptyPayment)
  const [f, setF] = useState<Figures>({
    amountDue: rupeesText(due.amountPaise),
    discount: rupeesText(due.discountPaise),
    lateFee: rupeesText(due.lateFeePaise),
    dueDate: due.dueDate,
    statusOverride: due.statusOverride ?? '',
    overrideReason: due.overrideReason ?? '',
    notes: due.notes ?? '',
  })
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const path = feesPath(schoolId)

  async function run(action: () => Promise<unknown>, done: () => void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onSaved()
      done()
    } catch (err) {
      setError(message(err, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  function addPayment(e: FormEvent) {
    e.preventDefault()
    const pay = readPayment(p, true)
    if ('error' in pay) return setError(pay.error ?? null)
    if (pay.paid > due.outstandingPaise) return setError(`That's more than the ${inr(due.outstandingPaise)} still due`)
    void run(() => api(`${path}/dues/${due.id}/payments`, { method: 'POST', body: JSON.stringify({ ...pay.body, idempotencyKey: paymentKey }) }), onClose)
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault()
    const figures = readFigures(f)
    if ('error' in figures) return setError(figures.error ?? null)
    if (figures.net < due.paidPaise) return setError(`${inr(due.paidPaise)} is already paid, so the net payable can’t be lower`)
    void run(() => api(`${path}/dues/${due.id}`, { method: 'PATCH', body: JSON.stringify(figures.body) }), onClose)
  }

  const live = due.payments.filter((x) => !x.voidedAt)
  return (
    <Dialog title={`${due.student.fullName} · ${due.structure.name}`} description={`${periodLabel(due.period, due.structure.frequency)} · due ${formatDay(due.dueDate)}`} onClose={onClose} widthClass="max-w-3xl">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            ['Amount Due', inr(due.amountPaise)],
            ['Discount', `− ${inr(due.discountPaise)}`],
            ['Late Fee', `+ ${inr(due.lateFeePaise)}`],
            ['Paid', inr(due.paidPaise)],
            ['Outstanding', inr(due.outstandingPaise)],
          ].map(([k, value]) => (
            <div key={k} className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">{k}</p>
              <p className="text-sm font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[due.status]}`}>{STATUS_LABELS[due.status]}</span>
          {due.statusOverride && <span className="text-xs text-slate-500">Set by an admin{due.overrideAt ? ` on ${formatDay(due.overrideAt.slice(0, 10))}` : ''}: {due.overrideReason}</span>}
        </p>
        {due.notes && <p className="text-xs whitespace-pre-line text-slate-500">{due.notes}</p>}

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900"><Receipt className="size-4" /> Payments ({live.length})</h3>
          {due.payments.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {due.payments.map((x) => (
                <li key={x.id} className={`px-4 py-3 text-sm ${x.voidedAt ? 'bg-slate-50 text-slate-400' : ''}`}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className={`font-semibold ${x.voidedAt ? 'line-through' : 'text-slate-900'}`}>{x.receiptNumber}</span>
                    <span>{inr(x.amountPaise)}</span>
                    <span>{METHOD_LABELS[x.method]}{x.transactionRef ? ` · ${x.transactionRef}` : ''}</span>
                    <span>{formatDay(x.paidOn)}</span>
                    {x.source === 'IMPORT' && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500 uppercase">Imported</span>}
                    {x.voidedAt ? (
                      <span className="text-xs">Voided: {x.voidReason}</span>
                    ) : (
                      <button type="button" onClick={() => setVoiding({ id: x.id, reason: '' })} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline">
                        <Ban className="size-3.5" /> Void
                      </button>
                    )}
                  </div>
                  {voiding?.id === x.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input autoFocus value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} maxLength={300} placeholder="Why is it being voided? (kept on record)" aria-label="Reason for voiding" className={`${field} flex-1`} />
                      <button
                        type="button"
                        disabled={busy || !voiding.reason.trim()}
                        onClick={() => void run(() => api(`${path}/payments/${x.id}/void`, { method: 'POST', body: JSON.stringify({ reason: voiding.reason }) }), onClose)}
                        className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Void Payment
                      </button>
                      <button type="button" onClick={() => setVoiding(null)} className="h-10 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">Keep</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {mode === 'pay' && (
          <form id="due-pay" onSubmit={addPayment} noValidate className={box}>
            <p className="mb-3 text-[11px] font-bold tracking-wider text-slate-700 uppercase">Add Payment</p>
            <PaymentFields v={p} set={(patch) => { setP((prev) => ({ ...prev, ...patch })); setError(null) }} required />
          </form>
        )}
        {mode === 'edit' && (
          <form id="due-edit" onSubmit={saveEdit} noValidate className={`${box} space-y-4`}>
            <p className="text-[11px] font-bold tracking-wider text-slate-700 uppercase">Edit Due</p>
            <FiguresFields v={f} set={(patch) => { setF((prev) => ({ ...prev, ...patch })); setError(null) }} lockAmount={due.paidPaise > 0} />
            <OverrideFields v={f} set={(patch) => { setF((prev) => ({ ...prev, ...patch })); setError(null) }} />
          </form>
        )}
        <ErrorBanner message={error} />
      </div>
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 px-6 py-4">
        {mode === 'view' ? (
          <>
            <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Close</button>
            <button type="button" onClick={() => setMode('edit')} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit Due</button>
            {due.outstandingPaise > 0 && (
              <button type="button" onClick={() => setMode('pay')} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-hover">
                <Plus className="size-4" /> Add Payment
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setMode('view'); setError(null) }} className="h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">Back</button>
            <button type="submit" form={mode === 'pay' ? 'due-pay' : 'due-edit'} disabled={busy} className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover disabled:opacity-60">
              {busy ? 'Saving…' : mode === 'pay' ? 'Record Payment' : 'Save Changes'}
            </button>
          </>
        )}
      </div>
    </Dialog>
  )
}

