// Shared form styling for the portal's modal forms.

export const labelClass = 'mb-1.5 block text-[11px] font-semibold tracking-wide text-slate-500 uppercase'

export const inputClass = (invalid?: boolean) =>
  `h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:ring-2 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400 ${
    invalid ? 'border-red-400 focus:ring-red-100' : 'border-slate-200 focus:border-indigo-300 focus:ring-indigo-100'
  }`

export const textareaClass = (invalid?: boolean) => `${inputClass(invalid).replace('h-10 ', '')} resize-y py-2.5`

export const btnPrimary =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink-hover disabled:opacity-60'
export const btnSecondary =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60'
export const btnDanger =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60'
