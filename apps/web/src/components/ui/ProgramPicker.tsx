import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useDismiss } from './useDismiss'
import { menuClass, optionClass } from './Select'

const MAX_PROGRAM_LENGTH = 40

type ProgramPickerProps = {
  id?: string
  standard: readonly string[]
  value: string[]
  onChange: (value: string[]) => void
}

/** Chips for chosen programs, with standard options and a "custom program" adder. */
export function ProgramPicker({ id, standard, value, onChange }: ProgramPickerProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  const has = (name: string) => value.some((v) => v.toLowerCase() === name.toLowerCase())
  const remove = (name: string) => onChange(value.filter((v) => v !== name))
  const toggle = (name: string) => (has(name) ? remove(name) : onChange([...value, name]))
  const Chevron = open ? ChevronUp : ChevronDown

  function addCustom() {
    const name = custom.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (name.length > MAX_PROGRAM_LENGTH) {
      setError(`Keep it under ${MAX_PROGRAM_LENGTH} characters`)
      return
    }
    if (has(name)) {
      setError(`${name} is already added`)
      return
    }
    onChange([...value, name])
    setCustom('')
    setError(null)
  }

  function onCustomKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  return (
    <div ref={ref} className="relative">
      <div
        id={id}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
        className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-2.5 focus-visible:ring-2 focus-visible:ring-indigo-100 focus-visible:outline-none"
      >
        <div className="flex flex-1 flex-wrap gap-1.5">
          {value.length === 0 && <span className="px-1 text-sm text-slate-400">Select programs</span>}
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pr-1.5 pl-2.5 text-xs font-semibold text-slate-900"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(name)
                }}
                className="rounded-full p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <Chevron className="size-4 shrink-0 text-slate-400" />
      </div>

      {open && (
        <div className={menuClass}>
          <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Standard programs
          </p>
          <ul id={listId} role="listbox" aria-multiselectable="true" className="pb-1">
            {standard.map((name) => (
              <li key={name} role="option" aria-selected={has(name)}>
                <button type="button" className={optionClass} onClick={() => toggle(name)}>
                  <span>{name}</span>
                  {has(name) && <Check className="size-4 text-ink" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 p-2.5">
            <div className="flex gap-2">
              <input
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value)
                  setError(null)
                }}
                onKeyDown={onCustomKey}
                placeholder="Add custom program..."
                aria-label="Custom program name"
                maxLength={MAX_PROGRAM_LENGTH + 10}
                className="h-8 flex-1 rounded-md border border-slate-200 px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustom}
                disabled={!custom.trim()}
                className="flex h-8 items-center gap-1 rounded-md bg-brand-500 px-3 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:bg-indigo-300"
              >
                <Plus className="size-3.5" /> Add
              </button>
            </div>
            {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
