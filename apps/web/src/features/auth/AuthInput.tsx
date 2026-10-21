import { useState, type InputHTMLAttributes } from 'react'
import { CircleAlert, Eye, EyeOff, type LucideIcon } from 'lucide-react'

type AuthInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string
  icon?: LucideIcon
}

// Outlined input with a trailing icon. Password inputs get a show/hide toggle instead.
export function AuthInput({ label, icon: Icon, type = 'text', ...props }: AuthInputProps) {
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'

  return (
    <label className="au-field">
      <span className="sr-only">{label}</span>
      <input
        type={isPassword && revealed ? 'text' : type}
        placeholder={label}
        className="au-input"
        {...props}
      />
      {isPassword ? (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          className="au-eye"
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      ) : (
        Icon && <Icon className="au-ico" />
      )}
    </label>
  )
}

export function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button type="submit" disabled={busy} className="au-btn">
      {busy && <span className="au-spin" aria-hidden="true" />}
      {busy ? busyLabel : label}
    </button>
  )
}

// Also used outside the auth screens (onboarding, preferences), so it is styled with utilities only.
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-[13px] leading-snug text-red-700"
    >
      <CircleAlert className="mt-px size-4 shrink-0" />
      <span>{message}</span>
    </p>
  )
}
