import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type FeeCategory = 'REGISTRATION' | 'MONTHLY_TUITION' | 'EXAM' | 'MATERIAL' | 'OTHER'
export type FeeFrequency = 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
export type FeeStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'WAIVED'
export type PaymentMethod = 'UPI' | 'CASH' | 'CARD' | 'NET_BANKING' | 'CHEQUE' | 'DD'

export const CATEGORY_LABELS: Record<FeeCategory, string> = {
  REGISTRATION: 'Registration Fee',
  MONTHLY_TUITION: 'Monthly Tuition',
  EXAM: 'Exam Fee',
  MATERIAL: 'Material Fee',
  OTHER: 'Other',
}
export const FREQUENCY_LABELS: Record<FeeFrequency, string> = { ONE_TIME: 'One-time', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' }
export const STATUS_LABELS: Record<FeeStatus, string> = {
  PAID: 'Paid',
  PENDING: 'Pending',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
  WAIVED: 'Waived / Scholarship',
}
export const STATUS_STYLE: Record<FeeStatus, string> = {
  PAID: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-slate-100 text-slate-700',
  PARTIAL: 'bg-amber-50 text-amber-700',
  OVERDUE: 'bg-red-50 text-red-700',
  WAIVED: 'bg-violet-50 text-violet-700',
}
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  UPI: 'UPI / QR',
  CASH: 'Cash',
  CARD: 'Card',
  NET_BANKING: 'Net Banking',
  CHEQUE: 'Cheque',
  DD: 'DD',
}

export type FeeSummary = {
  collectedThisMonthPaise: number
  collectedAllTimePaise: number
  pendingPaise: number
  pendingStudents: number
  overdueAccounts: number
  collectionRate: number | null
  dueCount: number
}

export type FeeStructure = {
  id: string
  name: string
  category: FeeCategory
  description: string | null
  amountPaise: number
  frequency: FeeFrequency
  dueDay: number
  mandatory: boolean
  program: { id: string; name: string } | null
  batch: { id: string; name: string } | null
  academicYear: string
  dueCount: number
  createdAt: string
}

export type Payment = {
  id: string
  receiptNumber: string
  amountPaise: number
  method: PaymentMethod
  transactionRef: string | null
  paidOn: string
  source: 'MANUAL' | 'IMPORT'
  notes: string | null
  voidedAt: string | null
  voidReason: string | null
}

export type Due = {
  id: string
  student: { id: string; fullName: string; rollNumber: string | null; admissionNumber: string | null; batch: string | null }
  structure: { id: string; name: string; category: FeeCategory; frequency: FeeFrequency }
  period: string
  dueDate: string
  amountPaise: number
  discountPaise: number
  lateFeePaise: number
  netPaise: number
  paidPaise: number
  outstandingPaise: number
  status: FeeStatus
  statusOverride: FeeStatus | null
  overrideReason: string | null
  overrideAt: string | null
  notes: string | null
  lastPaidOn: string | null
  payments: Payment[]
}

export type DuePage = { total: number; page: number; pageSize: number; items: Due[] }

export type StructureOption = { id: string; name: string; amountPaise: number; frequency: FeeFrequency; dueDay: number; batchId: string | null; programId: string | null }

const base = (schoolId: string) => `/schools/${schoolId}/fees`

const query = (f: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== '' && v !== undefined) params.set(k, String(v))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function useFeeSummary(schoolId: string) {
  return useQuery({ queryKey: [schoolId, 'fees', 'summary'], queryFn: () => api<FeeSummary>(`${base(schoolId)}/summary`) })
}

export function useFeeStructures(schoolId: string, filters: { q: string; category: string }) {
  return useQuery({
    queryKey: [schoolId, 'fees', 'structures', filters],
    queryFn: () => api<FeeStructure[]>(`${base(schoolId)}/structures${query(filters)}`),
    placeholderData: keepPreviousData,
  })
}

export function useDues(schoolId: string, filters: { q: string; status: string; page: number }) {
  return useQuery({
    queryKey: [schoolId, 'fees', 'dues', filters],
    queryFn: () => api<DuePage>(`${base(schoolId)}/dues${query({ ...filters, pageSize: 10 })}`),
    placeholderData: keepPreviousData,
  })
}

/** Every due matching the filters, for exports (pages of 200 until the last). */
export async function allDues(schoolId: string, filters: { q: string; status: string }) {
  const items: Due[] = []
  for (let page = 1; ; page++) {
    const chunk = await api<DuePage>(`${base(schoolId)}/dues${query({ ...filters, page, pageSize: 200 })}`)
    items.push(...chunk.items)
    if (page * chunk.pageSize >= chunk.total) return items
  }
}

export function useFeeOptions(schoolId: string) {
  return useQuery({
    queryKey: [schoolId, 'fees', 'options'],
    queryFn: () => api<{ structures: StructureOption[] }>(`${base(schoolId)}/options`),
  })
}

export function useInvalidateFees(schoolId: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: [schoolId, 'fees'] })
}

export const feesPath = base

/** Paise -> "₹12,500" / "₹12,500.50". */
export const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** A rupee amount typed in a form -> paise; null when it isn't an amount (two decimals at most). */
export function toPaise(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, '')
  if (!clean) return 0
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}

/** The due date for a month and due day: a day the month lacks becomes its last day (as the API does). */
export function dueDateIn(month: string, dueDay: number) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(Math.min(dueDay, last)).padStart(2, '0')}`
}

/** "2026-27" for today, with the year starting in `startMonth`. */
export function currentAcademicYear(today: string, startMonth: number) {
  const [y, m] = today.split('-').map(Number)
  const start = m >= startMonth ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** The billing period, read by the fee's frequency: "Oct 2026", "Q4 2026", "AY 2026-27" or "One-time". */
export function periodLabel(period: string, frequency: FeeFrequency) {
  switch (frequency) {
    case 'ONE_TIME':
      return 'One-time'
    case 'MONTHLY': {
      const [y, m] = period.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    }
    case 'QUARTERLY': {
      const [y, q] = period.split('-')
      return `${q} ${y}`
    }
    case 'YEARLY':
      return `AY ${period}`
  }
}
