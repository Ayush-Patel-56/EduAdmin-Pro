import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type SchoolOptions = {
  boards: string[]
  classes: string[]
  programs: string[]
  /** January … December; the form sends 1-12. */
  months: string[]
  defaults: { board: string; classes: string[]; programs: string[]; academicYearStartMonth: number }
}

export type SchoolFormValues = {
  name: string
  board: string
  academicYearStartMonth: number
  classes: string[]
  mouStartDate: string
  mouEndDate: string
  programs: string[]
  contactPerson: string
  phone: string
  email: string
  address: string
  gstNumber: string
}

/** The fields a school is created with, as the form holds them. */
export function emptySchoolValues(options: SchoolOptions): SchoolFormValues {
  return {
    name: '',
    board: options.defaults.board,
    academicYearStartMonth: options.defaults.academicYearStartMonth,
    classes: options.defaults.classes,
    mouStartDate: '',
    mouEndDate: '',
    programs: options.defaults.programs,
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    gstNumber: '',
  }
}

export function useSchoolOptions() {
  return useQuery({
    queryKey: ['school-options'],
    queryFn: () => api<SchoolOptions>('/schools/options'),
    staleTime: Infinity,
  })
}
