import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner, Field } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass } from '@/components/ui/formStyles'
import { Select } from '@/components/ui/Select'
import { emptyTest, TEST_TYPE_LABELS, testForm, testPayload, testProblem, type Options, type Test, type TestForm } from './api'

type Props = {
  base: string
  options: Options
  test: Test | null
  /** Pre-filled day when scheduling from the calendar strip. */
  date?: string
  title: string
  onSaved: (id: string) => Promise<unknown> | void
  onClose: () => void
}

/** Schedule / Create Test (PRD 4.10, 5.11). Tests are held outside the app; results are entered after. */
export function TestDialog({ base, options, test, date, title, onSaved, onClose }: Props) {
  const [form, setForm] = useState<TestForm>(() => (test ? testForm(test) : emptyTest(options.defaults, date ?? '')))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TestForm>(key: K, value: TestForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setError(null)
  }
  const batch = options.batches.find((b) => b.id === form.batchId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = testProblem(form)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const saved = await api<{ id: string }>(test ? `${base}/tests/${test.id}` : `${base}/tests`, { method: test ? 'PATCH' : 'POST', body: JSON.stringify(testPayload(form)) })
      await onSaved(saved.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the test')
      setBusy(false)
    }
  }

  return (
    <Dialog title={title} description="Times are India time (IST)." onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} noValidate>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <Field id="t-title" label="Test Title *" className="sm:col-span-2">
            <input id="t-title" value={form.title} maxLength={150} onChange={(e) => set('title', e.target.value)} placeholder="e.g. JEE Main Mock Test 3" className={inputClass()} />
          </Field>
          <Field id="t-batch" label="Batch *" hint={!options.batches.length ? 'No batches yet' : undefined}>
            <Select id="t-batch" value={form.batchId || null} placeholder="Select batch" options={options.batches.map((b) => ({ value: b.id, label: b.name }))} onChange={(v) => set('batchId', v)} />
          </Field>
          <Field id="t-program" label="Program">
            <input id="t-program" value={batch?.program.name ?? ''} readOnly placeholder="From the batch" className={`${inputClass()} bg-slate-50 text-slate-500`} />
          </Field>
          <Field id="t-type" label="Type *">
            <Select id="t-type" value={form.type || null} placeholder="Select type" options={options.testTypes.map((t) => ({ value: t, label: TEST_TYPE_LABELS[t] }))} onChange={(v) => set('type', v as TestForm['type'])} />
          </Field>
          <Field id="t-subject" label="Subject *">
            <Select id="t-subject" value={form.subject || null} placeholder="Select subject" options={options.subjects.map((s) => ({ value: s, label: s }))} onChange={(v) => set('subject', v)} />
          </Field>
          <Field id="t-date" label="Date *">
            <input id="t-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass()} />
          </Field>
          <Field id="t-time" label="Time *">
            <input id="t-time" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className={inputClass()} />
          </Field>
          <Field id="t-duration" label="Duration (minutes)">
            <input id="t-duration" type="number" min={1} max={720} value={form.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} className={inputClass()} />
          </Field>
          <Field id="t-total" label="Total Marks">
            <input id="t-total" type="number" min={1} max={10000} value={form.totalMarks} onChange={(e) => set('totalMarks', e.target.value)} className={inputClass()} />
          </Field>
          {error && (
            <div className="sm:col-span-2">
              <ErrorBanner message={error} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : test ? 'Save Changes' : 'Schedule Test'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
