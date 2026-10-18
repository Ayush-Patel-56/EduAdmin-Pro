// Shared classes and colours of the student report screens.

/** Bar colour by percentage: the topic bands (75 / 50). */
export const toneOf = (p: number | null) => (p === null ? 'bg-slate-300' : p >= 75 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-500' : 'bg-rose-500')

export const selectClass =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:opacity-60'
export const toolButton =
  'inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
