import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'TRANSFERRED' | 'COMPLETED'

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  TRANSFERRED: 'Transferred',
  COMPLETED: 'Completed',
}

export type StudentOptions = {
  genders: string[]
  bloodGroups: string[]
  statuses: StudentStatus[]
  relationships: string[]
}

type Ref = { id: string; name: string } | null

/** A roster row. Faculty get the same shape without the contact columns. */
export type StudentListItem = {
  id: string
  fullName: string
  rollNumber: string | null
  classLevel: string | null
  program: Ref
  batch: Ref
  phone?: string | null
  parentContact?: string | null
  email?: string | null
  status: StudentStatus
  photoUrl: string | null
}

export type StudentPage = { total: number; page: number; pageSize: number; items: StudentListItem[] }

export type Guardian = {
  id: string
  name: string
  relationship: string | null
  phone: string | null
  altPhone: string | null
  email: string | null
  occupation: string | null
  annualIncome: number | null
  isPrimary: boolean
}

export type Enrollment = {
  id: string
  /** The batch and program names when the enrollment was made (kept if the batch is deleted). */
  batch: string
  program: string
  batchExists: boolean
  rollNumber: string | null
  enrolledOn: string | null
  endedOn: string | null
}

/** What an admin sees and edits. */
export type StudentDetail = {
  id: string
  fullName: string
  admissionNumber: string | null
  aadharNumber: string | null
  rollNumber: string | null
  email: string | null
  phone: string | null
  parentContact: string | null
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  dateOfBirth: string | null
  gender: string | null
  bloodGroup: string | null
  profileImageUrl: string | null
  photoFileId: string | null
  photoUrl: string | null
  previousSchool: string | null
  previousPercentage: number | null
  classLevel: string | null
  program: Ref
  batch: Ref
  admissionDate: string | null
  status: StudentStatus
  notes: string | null
  createdAt: string
  guardians: Guardian[]
  enrollments: Enrollment[]
}

/** The faculty view of one student: no identity numbers, contacts, address or guardians (notes are shown, PRD 5.5). */
export type TeacherStudentDetail = Pick<
  StudentDetail,
  | 'id'
  | 'fullName'
  | 'rollNumber'
  | 'classLevel'
  | 'program'
  | 'batch'
  | 'photoUrl'
  | 'gender'
  | 'previousSchool'
  | 'previousPercentage'
  | 'admissionDate'
  | 'status'
  | 'notes'
  | 'enrollments'
>

export type RosterFilters = { q: string; classLevel: string; programId: string; batchId: string; page: number; status?: StudentStatus | '' }

export function rosterQuery(filters: Partial<RosterFilters> & { pageSize?: number }) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== undefined && value !== null) params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function useStudentOptions() {
  return useQuery({
    queryKey: ['student-options'],
    queryFn: () => api<StudentOptions>('/students/options'),
    staleTime: Infinity,
  })
}

/** "Live Sync": the roster refreshes on its own every 30 s and when the tab regains focus. */
const LIVE = { refetchInterval: 30_000, refetchOnWindowFocus: true, placeholderData: keepPreviousData } as const

export function useAdminRoster(schoolId: string, filters: RosterFilters) {
  return useQuery({
    queryKey: [schoolId, 'students', filters],
    queryFn: () => api<StudentPage>(`/schools/${schoolId}/students${rosterQuery({ ...filters, pageSize: 25 })}`),
    ...LIVE,
  })
}

export function useAdminStudent(schoolId: string, studentId: string | null) {
  return useQuery({
    queryKey: [schoolId, 'student', studentId],
    queryFn: () => api<StudentDetail>(`/schools/${schoolId}/students/${studentId}`),
    enabled: !!studentId,
  })
}

export function useTeacherRoster(filters: Omit<RosterFilters, 'page'>) {
  return useQuery({
    queryKey: ['teacher-students', filters],
    queryFn: () => api<StudentPage>(`/teacher/students${rosterQuery({ ...filters, pageSize: 100 })}`),
    ...LIVE,
  })
}

export function useTeacherStudent(studentId: string | null) {
  return useQuery({
    queryKey: ['teacher-student', studentId],
    queryFn: () => api<TeacherStudentDetail>(`/teacher/students/${studentId}`),
    enabled: !!studentId,
  })
}

/** After any change: the roster, the open profile, and promotion counts. */
export function useInvalidateStudents(schoolId: string) {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [schoolId, 'students'] }),
      client.invalidateQueries({ queryKey: [schoolId, 'student'] }),
      client.invalidateQueries({ queryKey: [schoolId, 'promotion'] }),
    ])
}

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')

/** Header search: up to 5 students matching a name, admission or roll number. */
export async function searchStudents(portal: { kind: 'admin'; schoolId: string } | { kind: 'teacher' }, query: string) {
  const path =
    portal.kind === 'admin'
      ? `/schools/${portal.schoolId}/students${rosterQuery({ q: query, pageSize: 5 })}`
      : `/teacher/students${rosterQuery({ q: query, pageSize: 5 })}`
  const { items } = await api<StudentPage>(path)
  const base = portal.kind === 'admin' ? '/management/students' : '/teacher/students'
  return items.map((s) => ({
    label: [s.fullName, s.classLevel && `Class ${s.classLevel}`, s.batch?.name].filter(Boolean).join(' · '),
    to: `${base}?student=${s.id}`,
    group: 'Students',
  }))
}
