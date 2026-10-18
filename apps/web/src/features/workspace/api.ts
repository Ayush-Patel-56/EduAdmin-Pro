import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type MaterialType = 'NOTES' | 'PDF' | 'VIDEO' | 'PRACTICE_SHEET' | 'DPP' | 'REFERENCE' | 'ANSWER_KEY'
export type AssignmentType = 'HOMEWORK' | 'DPP' | 'WORKSHEET' | 'PROJECT' | 'REVISION'
export type SubmissionStatus = 'PENDING' | 'SUBMITTED' | 'LATE' | 'GRADED'

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  NOTES: 'Notes',
  PDF: 'PDF',
  VIDEO: 'Video',
  PRACTICE_SHEET: 'Practice Sheet',
  DPP: 'DPP',
  REFERENCE: 'Reference',
  ANSWER_KEY: 'Answer Key',
}
export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  HOMEWORK: 'Homework',
  DPP: 'DPP',
  WORKSHEET: 'Worksheet',
  PROJECT: 'Project',
  REVISION: 'Revision',
}
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  LATE: 'Late',
  GRADED: 'Graded',
}

export type FileView = { name: string; contentType: string; size: number; url: string | null }

export type Material = {
  id: string
  title: string
  description: string | null
  provider: string
  chapter: string | null
  subject: string
  type: MaterialType
  isPublic: boolean
  batch: { id: string; name: string }
  uploadedBy: string | null
  mine: boolean
  fileId: string
  file: FileView
  createdAt: string
}

export type Assignment = {
  id: string
  title: string
  description: string | null
  chapter: string
  /** The curriculum chapter it's linked to, and the topic it practises (topic strength in the student reports). */
  chapterId: string | null
  topic: string | null
  subject: string
  type: AssignmentType
  batch: { id: string; name: string }
  dueAt: string
  dueDate: string
  dueTime: string
  totalMarks: number
  setBy: string | null
  mine: boolean
  questionFileId: string | null
  questionFile: FileView | null
  students: number
  handedIn: number
  graded: number
}

export type GradingSheet = {
  assignment: { id: string; title: string; totalMarks: number; dueAt: string; batch: string }
  students: {
    student: { id: string; fullName: string; rollNumber: string | null }
    submission: {
      status: SubmissionStatus
      score: number | null
      feedback: string | null
      submittedOn: string | null
      gradedAt: string | null
      file: FileView | null
      fileId: string | null
    } | null
  }[]
}

export type WorkspaceOptions = {
  subjects: string[]
  materialTypes: MaterialType[]
  assignmentTypes: AssignmentType[]
  submissionStatuses: SubmissionStatus[]
}

export type WorkspaceFilters = { batchId: string; type: string; q: string }

const query = (f: Partial<WorkspaceFilters>) => {
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()
  return params ? `?${params}` : ''
}

export function useWorkspaceOptions() {
  return useQuery({ queryKey: ['workspace-options'], queryFn: () => api<WorkspaceOptions>('/workspace/options'), staleTime: Infinity })
}

export type CurriculumChapter = { id: string; name: string; subject: string; concepts: string[] }

/** The school's curriculum chapters with their concepts, for linking an assignment to a chapter and topic. */
export function useWorkspaceChapters() {
  return useQuery({ queryKey: ['teacher', 'workspace', 'chapters'], queryFn: () => api<CurriculumChapter[]>('/teacher/workspace/chapters'), staleTime: 60_000 })
}

/** Teacher: their batches' material and assignments. Admin (`schoolId`): everything in the school. */
export function useMaterials(filters: Partial<WorkspaceFilters>, schoolId?: string) {
  return useQuery({
    queryKey: [schoolId ?? 'teacher', 'workspace', 'materials', filters],
    queryFn: () => api<Material[]>(`${schoolId ? `/schools/${schoolId}/workspace` : '/teacher/workspace'}/materials${query(filters)}`),
  })
}

export function useAssignments(filters: Partial<WorkspaceFilters>, schoolId?: string) {
  return useQuery({
    queryKey: [schoolId ?? 'teacher', 'workspace', 'assignments', filters],
    queryFn: () => api<Assignment[]>(`${schoolId ? `/schools/${schoolId}/workspace` : '/teacher/workspace'}/assignments${query(filters)}`),
  })
}

export function useGradingSheet(assignmentId: string | null) {
  return useQuery({
    queryKey: ['teacher', 'workspace', 'grading', assignmentId],
    queryFn: () => api<GradingSheet>(`/teacher/workspace/assignments/${assignmentId}/submissions`),
    enabled: !!assignmentId,
  })
}

export function useInvalidateWorkspace() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['teacher', 'workspace'] }),
      client.invalidateQueries({ queryKey: ['teacher-dashboard'] }),
    ])
}
