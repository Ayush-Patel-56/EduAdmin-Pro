import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useDismiss } from '@/components/ui/useDismiss'

export type SearchItem = { label: string; to: string; group: string }

const MAX_RESULTS = 8

/**
 * Header typeahead. Results are grouped by type; today that's the portal's
 * pages, and students, classes and reports join as those modules ship.
 */
export function GlobalSearch({ items }: { items: SearchItem[] }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listId = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return items.filter((i) => i.label.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
  }, [items, query])

  function go(item: SearchItem) {
    navigate(item.to)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      go(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const groups = [...new Set(results.map((r) => r.group))]
  const showMenu = open && query.trim() !== ''

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        role="combobox"
        aria-expanded={showMenu}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showMenu && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search students, classes, or reports..."
        className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-50 focus:outline-none"
      />
      {showMenu && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.2)]"
        >
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">No matches for “{query.trim()}”</p>
          ) : (
            groups.map((group) => (
              <div key={group} role="group" aria-label={group}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">{group}</p>
                {results.map((r, i) =>
                  r.group === group ? (
                    <button
                      key={r.to}
                      id={`${listId}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={`block w-full px-3 py-2 text-left text-sm text-slate-700 ${i === active ? 'bg-slate-50' : ''}`}
                    >
                      {r.label}
                    </button>
                  ) : null,
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
