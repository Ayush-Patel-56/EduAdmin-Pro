import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useDismiss } from './useDismiss'
import { summarize } from '@/lib/summarize'
import { menuClass, optionClass, triggerClass } from './Select'

type MultiSelectProps = {
  id?: string
  /** All options, in display order. */
  options: readonly string[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  invalid?: boolean
}

export function MultiSelect({ id, options, value, onChange, placeholder = 'Select…', invalid }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  // Open scrolled so the selection is in view, rather than always at the top.
  useEffect(() => {
    const list = listRef.current
    if (!open || !list) return
    const chosen = list.querySelectorAll<HTMLElement>('[aria-selected="true"]')
    const last = chosen[chosen.length - 1]
    if (last) list.scrollTop = Math.max(0, last.offsetTop + last.offsetHeight - list.clientHeight + 8)
    // Only on open: toggling options must not jump the list around.
  }, [open])

  const selected = new Set(value)
  const summary = summarize(options, value)
  const Chevron = open ? ChevronUp : ChevronDown

  function toggle(option: string) {
    const next = selected.has(option) ? value.filter((v) => v !== option) : [...value, option]
    // Keep stored order consistent with the option list.
    onChange(options.filter((o) => next.includes(o)))
  }

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={`${triggerClass} h-10 ${invalid ? 'border-red-300' : 'border-slate-200'}`}
      >
        <span className={`flex-1 truncate ${summary ? 'font-semibold' : 'text-slate-400'}`}>
          {summary || placeholder}
        </span>
        <Chevron className="size-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className={`${menuClass} max-h-56 overflow-y-auto py-1`}
        >
          {options.map((o) => (
            <li key={o} role="option" aria-selected={selected.has(o)}>
              <button type="button" className={optionClass} onClick={() => toggle(o)}>
                <span>{o}</span>
                {selected.has(o) && <Check className="size-4 text-ink" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
