import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Where academic data comes from: an admin works on a school they pick,
 * a teacher always on their own school (the API resolves it from the session).
 */
export type AcademicSource = { kind: 'admin'; schoolId: string } | { kind: 'teacher' }

export const basePath = (s: AcademicSource) => (s.kind === 'admin' ? `/schools/${s.schoolId}` : '/teacher')
/** First element of every academic query key, so each school's data is cached separately. */
export const sourceKey = (s: AcademicSource) => (s.kind === 'admin' ? s.schoolId : 'teacher')

export type SyllabusStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
export type ProgramType = 'JEE' | 'NEET' | 'FOUNDATIONAL' | 'OTHER'
export type ThemeColor = 'BLUE' | 'GREEN' | 'PURPLE'
export type FacultyStatus = 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE'

export type AcademicOptions = {
  subjects: string[]
  programTypes: ProgramType[]
  themeColors: ThemeColor[]
  targetExams: string[]
  classLevels: number[]
  syllabusStatuses: SyllabusStatus[]
  facultyStatuses: FacultyStatus[]
}

export type Structure = {
  programs: { id: string; name: string; isActive: boolean; themeColor: ThemeColor }[]
  batches: { id: string; name: string; programId: string; classLevel: number | null }[]
}

export type Program = {
  id: string
  name: string
  code: string | null
  type: ProgramType
  targetExams: string[]
  durationYears: number | null
  themeColor: ThemeColor
  isActive: boolean
  batchCount: number
  facultyCount: number
  /** Calendar events for the whole program (deleted with it). */
  eventCount: number
}

export type Batch = {
  id: string
  name: string
  program: { id: string; name: string; themeColor: ThemeColor }
  classLevel: number | null
  capacity: number
  startDate: string
  endDate: string | null
  coordinator: { id: string; name: string } | null
  facultyCount: number
  chapterCount: number
  studentCount: number
  materialCount: number
  assignmentCount: number
  /** Calendar events for this batch (deleted with it). */
  eventCount: number
}

export type Faculty = {
  id: string
  name: string
  email: string | null
  phone: string | null
  employeeId: string | null
  subjects: string[]
  specialization: string | null
  qualification: string | null
  experienceYears: number | null
  joiningDate: string | null
  status: FacultyStatus
  linked: boolean
  batches: { id: string; name: string; role: string }[]
}

export type SyllabusItem = {
  id: string
  batchId: string
  subject: string
  title: string
  estimatedHours: number | null
  targetDates: string | null
  status: SyllabusStatus
  remarks: string | null
  updatedAt: string
}

export type ImportPreview = {
  applied: boolean
  created: number
  updated: number
  skipped: number
  rows: { row: number; label: string; action: 'create' | 'update' | 'error'; errors: string[] }[]
}

export const STATUS_LABELS: Record<SyllabusStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
}

export const PROGRAM_TYPE_LABELS: Record<ProgramType, string> = {
  JEE: 'JEE',
  NEET: 'NEET',
  FOUNDATIONAL: 'Foundational',
  OTHER: 'Other',
}

export const THEME_LABELS: Record<ThemeColor, string> = { BLUE: 'Blue', GREEN: 'Green', PURPLE: 'Purple' }

export const FACULTY_STATUS_LABELS: Record<FacultyStatus, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On Leave',
  INACTIVE: 'Inactive',
}

export function useAcademicOptions() {
  return useQuery({
    queryKey: ['academic-options'],
    queryFn: () => api<AcademicOptions>('/academic/options'),
    staleTime: Infinity,
  })
}

export const structureKey = (s: AcademicSource) => [sourceKey(s), 'structure'] as const

export function useStructure(s: AcademicSource, enabled = true) {
  return useQuery({
    queryKey: structureKey(s),
    queryFn: () => api<Structure>(`${basePath(s)}/structure`),
    enabled,
  })
}

export const syllabusKey = (s: AcademicSource, batchId: string, subject?: string) =>
  [sourceKey(s), 'syllabus', batchId, subject ?? 'all'] as const

export function useSyllabus(s: AcademicSource, batchId: string | null, subject: string) {
  return useQuery({
    queryKey: syllabusKey(s, batchId ?? '', subject),
    queryFn: () =>
      api<SyllabusItem[]>(`${basePath(s)}/syllabus?batchId=${batchId}&subject=${encodeURIComponent(subject)}`),
    enabled: !!batchId,
    // Admin and faculty edit the same chapters; poll so each side sees the
    // other's changes without a manual refresh.
    refetchInterval: 15_000,
  })
}

/** Refreshes everything a structural change (program/batch/faculty/school) can affect. */
export function useInvalidateAcademic() {
  const queryClient = useQueryClient()
  return (s: AcademicSource) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [sourceKey(s)] }),
      s.kind === 'admin' ? queryClient.invalidateQueries({ queryKey: ['dashboard', s.schoolId] }) : null,
      queryClient.invalidateQueries({ queryKey: ['my-schools'] }),
    ])
}
