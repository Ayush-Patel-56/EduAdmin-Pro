import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '@/lib/api'
import { EMAIL_PATTERN, isValidGstin, isValidIndianMobile } from '@/lib/validators'
import { Select } from '@/components/ui/Select'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { ProgramPicker } from '@/components/ui/ProgramPicker'
import { FormError } from '@/features/auth/AuthInput'
import { fieldLabelClass } from './OnboardingCard'
import { emptySchoolValues, type SchoolFormValues, type SchoolOptions } from './schoolOptions'

type Errors = Partial<Record<keyof SchoolFormValues, string>>

// Order matches the form, so the first error found is the first one on screen.
function validate(v: SchoolFormValues): Errors {
  const errors: Errors = {}
  const name = v.name.trim()
  if (!name) errors.name = 'School name is required'
  else if (name.length < 3) errors.name = 'School name must be at least 3 characters'
  if (!v.board.trim()) errors.board = 'Please select or enter a board'
  if (v.classes.length === 0) errors.classes = 'Select at least one class'
  if (v.mouStartDate && v.mouEndDate && v.mouEndDate < v.mouStartDate) {
    errors.mouEndDate = 'End date must be on or after the start date'
  }
  if (v.phone.trim() && !isValidIndianMobile(v.phone)) errors.phone = 'Enter a valid 10-digit mobile number'
  if (v.email.trim() && !EMAIL_PATTERN.test(v.email.trim())) errors.email = 'Enter a valid email address'
  const gst = v.gstNumber.replace(/\s/g, '').toUpperCase()
  if (gst && !isValidGstin(gst)) errors.gstNumber = 'Enter a valid 15-character GST number'
  return errors
}

// Colours live only in the state branches so they never compete in the cascade.
const fillClass = (invalid?: boolean) =>
  `w-full rounded-lg border px-4 text-sm text-slate-900 placeholder:text-slate-400 transition focus:ring-2 focus:outline-none ${
    invalid
      ? 'border-red-400 bg-red-50 focus:ring-red-100'
      : 'border-transparent bg-slate-100 focus:border-indigo-200 focus:bg-slate-50 focus:ring-indigo-100'
  }`
const outlineClass = (invalid?: boolean) =>
  `w-full rounded-lg border bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 transition focus:ring-2 focus:outline-none ${
    invalid ? 'border-red-400 focus:ring-red-100' : 'border-slate-200 focus:border-indigo-300 focus:ring-indigo-100'
  }`

type SchoolFormProps = {
  options: SchoolOptions
  initial?: SchoolFormValues
  /** Saves the school; throw (e.g. ApiError) to show the message under the form. */
  onSubmit: (values: SchoolFormValues) => Promise<void>
  submitLabel: string
  submittingLabel: string
  /** Shown above the buttons, e.g. the auto-generated invite code note. */
  note?: string
  /** Dialog mode: adds a Cancel button and uses outlined inputs. */
  onCancel?: () => void
}

export function SchoolForm({ options, initial, onSubmit, submitLabel, submittingLabel, note, onCancel }: SchoolFormProps) {
  const [values, setValues] = useState<SchoolFormValues>(() => initial ?? emptySchoolValues(options))
  const inputClass = onCancel ? outlineClass : fillClass
  // A board that isn't one of the standard ones (set earlier) opens as custom text.
  const [customBoard, setCustomBoard] = useState(() => !!initial && !options.boards.includes(initial.board))
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function set<K extends keyof SchoolFormValues>(key: K, value: SchoolFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    setServerError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate(values)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      const el = document.getElementById(`school-${first}`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.focus({ preventScroll: true })
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({ ...values, gstNumber: values.gstNumber.replace(/\s/g, '').toUpperCase() })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Unable to reach the server')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div
        className={`-mr-3 space-y-4 overflow-y-auto pr-3 pb-1 ${
          onCancel ? 'max-h-[min(560px,calc(100dvh-260px))]' : 'max-h-[min(520px,calc(100dvh-280px))] min-h-[240px]'
        }`}
      >
        <Field id="school-name" label="School name *" error={errors.name}>
          <input
            id="school-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Riverdale Coaching Institute"
            autoComplete="organization"
            maxLength={150}
            autoFocus={!initial}
            className={`h-10 ${inputClass(!!errors.name)}`}
          />
        </Field>

        <Field id="school-board" label="Board" error={errors.board}>
          {customBoard ? (
            <div>
              <input
                id="school-board"
                value={values.board}
                onChange={(e) => set('board', e.target.value)}
                placeholder="Enter board name"
                maxLength={60}
                autoFocus
                className={`h-10 ${inputClass(!!errors.board)}`}
              />
              <button
                type="button"
                onClick={() => {
                  setCustomBoard(false)
                  set('board', options.defaults.board)
                }}
                className="mt-1 text-[11px] font-medium text-brand-600 hover:underline"
              >
                Choose from list instead
              </button>
            </div>
          ) : (
            <Select
              id="school-board"
              value={values.board}
              options={options.boards.map((b) => ({ value: b, label: b }))}
              onChange={(b) => set('board', b)}
              invalid={!!errors.board}
              footer={[
                {
                  label: '+ Custom Board...',
                  onSelect: () => {
                    setCustomBoard(true)
                    set('board', '')
                  },
                },
              ]}
            />
          )}
        </Field>

        <Field id="school-academicYearStartMonth" label="Academic year starts in">
          <Select
            id="school-academicYearStartMonth"
            value={String(values.academicYearStartMonth)}
            options={options.months.map((m, i) => ({ value: String(i + 1), label: m }))}
            onChange={(m) => set('academicYearStartMonth', Number(m))}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-3">
          <Field id="school-classes" label="Classes" error={errors.classes}>
            <MultiSelect
              id="school-classes"
              options={options.classes}
              value={values.classes}
              onChange={(c) => set('classes', c)}
              placeholder="Select classes"
              invalid={!!errors.classes}
            />
          </Field>
          <Field id="school-mouStartDate" label="MOU dates" error={errors.mouEndDate}>
            <div className="grid grid-cols-2 gap-2">
              <input
                id="school-mouStartDate"
                type="date"
                aria-label="MOU start date"
                value={values.mouStartDate}
                onChange={(e) => set('mouStartDate', e.target.value)}
                className={`h-10 px-2.5! text-xs! ${inputClass()}`}
              />
              <input
                id="school-mouEndDate"
                type="date"
                aria-label="MOU end date"
                min={values.mouStartDate || undefined}
                value={values.mouEndDate}
                onChange={(e) => set('mouEndDate', e.target.value)}
                className={`h-10 px-2.5! text-xs! ${inputClass(!!errors.mouEndDate)}`}
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">Leave End Date blank for an ongoing MOU.</p>
          </Field>
        </div>

        <Field id="school-programs" label="Programs">
          <ProgramPicker
            id="school-programs"
            standard={options.programs}
            value={values.programs}
            onChange={(p) => set('programs', p)}
          />
        </Field>

        <Field id="school-contactPerson" label="Contact person">
          <input
            id="school-contactPerson"
            value={values.contactPerson}
            onChange={(e) => set('contactPerson', e.target.value)}
            placeholder="e.g. John Doe"
            autoComplete="name"
            maxLength={120}
            className={`h-10 ${inputClass()}`}
          />
        </Field>

        <Field id="school-phone" label="Phone" error={errors.phone}>
          <input
            id="school-phone"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="e.g. 9876543210"
            autoComplete="tel"
            maxLength={16}
            className={`h-10 ${inputClass(!!errors.phone)}`}
          />
        </Field>

        <Field id="school-email" label="Email" error={errors.email}>
          <input
            id="school-email"
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="e.g. contact@school.edu"
            autoComplete="email"
            maxLength={254}
            className={`h-10 ${inputClass(!!errors.email)}`}
          />
        </Field>

        <Field id="school-address" label="Address">
          <textarea
            id="school-address"
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="e.g. 123 Education St, City"
            rows={2}
            maxLength={500}
            className={`resize-y py-2.5 ${inputClass()}`}
          />
        </Field>

        <Field id="school-gstNumber" label="GST No." error={errors.gstNumber}>
          <input
            id="school-gstNumber"
            value={values.gstNumber}
            onChange={(e) => set('gstNumber', e.target.value.toUpperCase())}
            placeholder="e.g. 07AAAAA1111A1Z1"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            className={`h-10 ${inputClass(!!errors.gstNumber)}`}
          />
        </Field>
      </div>

      {note && <p className="mt-3 text-[11px] text-slate-400">{note}</p>}
      <FormError message={serverError} />
      <div className={`mt-4 grid gap-3 ${onCancel ? 'grid-cols-2' : ''}`}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="h-10 w-full rounded-lg bg-ink text-sm font-semibold text-white transition hover:bg-ink-hover disabled:opacity-60"
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
