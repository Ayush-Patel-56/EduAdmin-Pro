import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff, type LucideIcon } from 'lucide-react'

type AuthInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string
  icon?: LucideIcon
}

const inputClass =
  'h-10 w-full rounded-lg bg-slate-100 pr-10 pl-4 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-600/40 focus:outline-none'

// Grey pill input with a trailing icon. Password inputs get a show/hide toggle instead.
export function AuthInput({ label, icon: Icon, type = 'text', ...props }: AuthInputProps) {
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'

  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <input
        type={isPassword && revealed ? 'text' : type}
        placeholder={label}
        className={inputClass}
        {...props}
      />
      {isPassword ? (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      ) : (
        Icon && (
          <Icon className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-slate-400" />
        )
      )}
    </label>
  )
}

export function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-4 h-10 w-full rounded-lg bg-ink text-sm font-semibold text-white transition hover:bg-ink-hover disabled:opacity-60"
    >
      {busy ? busyLabel : label}
    </button>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-3 text-center text-xs text-red-600">
      {message}
    </p>
  )
}
