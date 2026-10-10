import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'
import { useDismiss } from './useDismiss'

export type SelectOption = { value: string; label: string }

type FooterAction = { label: ReactNode; onSelect: () => void }

type SelectProps = {
  id?: string
  value: string | null
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  /** Extra actions under a divider, e.g. "+ Custom Board…". */
  footer?: FooterAction[]
  icon?: LucideIcon
  iconClassName?: string
  size?: 'md' | 'sm'
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
}

export const triggerClass =
  'flex w-full items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm text-slate-900 transition focus-visible:ring-2 focus-visible:ring-indigo-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-slate-400'

export const menuClass =
  'absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_30px_-10px_rgba(15,23,42,0.2)]'

export const optionClass =
  'flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none'

export function Select({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  footer,
  icon: Icon,
  iconClassName,
  size = 'md',
  disabled,
  invalid,
  ...aria
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  const selected = options.find((o) => o.value === value)
  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={aria['aria-label']}
        onClick={() => setOpen((o) => !o)}
        className={`${triggerClass} ${size === 'sm' ? 'h-9' : 'h-10'} ${invalid ? 'border-red-300' : 'border-slate-200'}`}
      >
        {Icon && <Icon className={`size-4 shrink-0 ${iconClassName ?? 'text-slate-400'}`} />}
        <span className={`flex-1 truncate ${selected ? '' : 'text-slate-400'}`}>
          {selected?.label ?? placeholder}
        </span>
        <Chevron className="size-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className={menuClass}>
          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {options.map((o) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  type="button"
                  className={optionClass}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <Check className="size-4 shrink-0 text-ink" />}
                </button>
              </li>
            ))}
          </ul>
          {footer && footer.length > 0 && (
            <div className="border-t border-slate-100 py-1">
              {footer.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  className={`${optionClass} font-semibold text-ink`}
                  onClick={() => {
                    setOpen(false)
                    action.onSelect()
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
