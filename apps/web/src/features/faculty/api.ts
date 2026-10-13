import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { FacultyStatus } from '@/features/academic/api'

export type Designation = 'TEACHER' | 'COORDINATOR'
export type BatchRole = 'PRIMARY' | 'SUBSTITUTE' | 'ASSISTANT'

export const DESIGNATION_LABELS: Record<Designation, string> = { TEACHER: 'Teacher', COORDINATOR: 'Coordinator' }
export const BATCH_ROLE_LABELS: Record<BatchRole, string> = { PRIMARY: 'Primary', SUBSTITUTE: 'Substitute', ASSISTANT: 'Assistant' }

export type DirectoryRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  primarySubject: string | null
  joiningDate: string | null
  batchCount: number
  status: FacultyStatus
  designation: Designation
  linked: boolean
  photoUrl: string | null
}

export type FacultyDetail = {
  id: string
  name: string
  email: string | null
  phone: string | null
  altPhone: string | null
  employeeId: string | null
  dateOfBirth: string | null
  gender: string | null
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  subjects: string[]
  primarySubject: string | null
  primaryStream: string | null
  specialization: string | null
  qualification: string | null
  experienceYears: number | null
  joiningDate: string | null
  status: FacultyStatus
  designation: Designation
  bio: string | null
  profileImageUrl: string | null
  photoFileId: string | null
  photoUrl: string | null
  linked: boolean
  programs: { id: string; name: string }[]
  batches: { id: string; name: string; program: string; role: BatchRole }[]
  counts: { materials: number; assignments: number; counseling: number }
}

export type PortalOverview = {
  kpis: { totalFaculty: number; activeBatchesCovered: number; materialsUploaded: number; counselingSessions: number }
  recentMaterials: {
    id: string
    title: string
    type: string
    subject: string
    batch: string
    uploadedBy: string | null
    createdAt: string
    file: { name: string; contentType: string; size: number; url: string | null }
  }[]
  recentCounseling: { id: string; student: string; counselor: string; type: string; status: string; scheduledAt: string }[]
}

export type PortalOptions = { streams: string[]; designations: Designation[]; batchRoles: BatchRole[] }

const base = (schoolId: string) => `/schools/${schoolId}/teacher-portal`

export function usePortalOverview(schoolId: string) {
  return useQuery({ queryKey: [schoolId, 'teacher-portal', 'overview'], queryFn: () => api<PortalOverview>(`${base(schoolId)}/overview`) })
}

export function useDirectory(schoolId: string) {
  return useQuery({ queryKey: [schoolId, 'teacher-portal', 'faculty'], queryFn: () => api<DirectoryRow[]>(`${base(schoolId)}/faculty`) })
}

export function useFacultyDetail(schoolId: string, facultyId: string | null) {
  return useQuery({
    queryKey: [schoolId, 'teacher-portal', 'faculty', facultyId],
    queryFn: () => api<FacultyDetail>(`${base(schoolId)}/faculty/${facultyId}`),
    enabled: !!facultyId,
  })
}

export function usePortalOptions(schoolId: string) {
  return useQuery({
    queryKey: [schoolId, 'teacher-portal', 'options'],
    queryFn: () => api<PortalOptions>(`${base(schoolId)}/options`),
    staleTime: Infinity,
  })
}

/** Faculty changes show in the portal and in Academic Planning's faculty tab and filters. */
export function useInvalidateFaculty(schoolId: string) {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [schoolId, 'teacher-portal'] }),
      client.invalidateQueries({ queryKey: [schoolId, 'faculty'] }),
      client.invalidateQueries({ queryKey: [schoolId, 'batches'] }),
    ])
}

export const facultyApi = (schoolId: string, facultyId: string) => `${base(schoolId)}/faculty/${facultyId}`

/** The teacher's own profile (My Profile). */
export function useMyProfile(enabled = true) {
  return useQuery({ queryKey: ['teacher-profile'], queryFn: () => api<FacultyDetail>('/teacher/profile'), enabled })
}
