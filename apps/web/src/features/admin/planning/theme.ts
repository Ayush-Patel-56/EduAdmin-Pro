import type { ThemeColor } from '@/features/academic/api'

/** Colours for a program's theme, used on program cards and batch chips. */
export const THEME_STYLES: Record<ThemeColor, { bar: string; chip: string }> = {
  BLUE: { bar: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700' },
  GREEN: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  PURPLE: { bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700' },
}
