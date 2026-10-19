import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

type Place = { top: number; left: number }

/**
 * A "⋮" actions menu drawn over the page (in a portal, fixed to the viewport),
 * so a table's scroll container can't clip it. It opens under the button, or
 * above it near the bottom of the screen, and closes on a click outside,
 * Escape, scrolling or resizing.
 */
export function FloatingMenu({ label, width = 176, children }: { label: string; width?: number; children: (close: () => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setAnchor(null)
    setPlace(null)
  }, [])

  // Placed once it has drawn and its height is known: below the button, else above it; always on screen.
  useLayoutEffect(() => {
    if (!anchor || !menu.current) return
    const height = menu.current.offsetHeight
    const gap = 4
    const below = anchor.bottom + gap + height <= window.innerHeight - 8
    const top = below ? anchor.bottom + gap : Math.max(8, anchor.top - gap - height)
    const left = Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8)
    setPlace({ top, left })
  }, [anchor, width])

  useEffect(() => {
    if (!anchor) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [anchor, close])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={() => (anchor ? close() : setAnchor(button.current!.getBoundingClientRect()))}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <MoreVertical className="size-4" />
      </button>
      {anchor &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: 'fixed', top: place?.top ?? anchor.bottom + 4, left: place?.left ?? anchor.right - width, width, visibility: place ? 'visible' : 'hidden' }}
            className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]"
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  )
}
