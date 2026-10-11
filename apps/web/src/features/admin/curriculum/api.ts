import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type CurriculumOptions = {
  subjects: string[]
  boards: string[]
  /** The classes this school offers, in display order. */
  classes: string[]
  programs: { id: string; name: string }[]
}

export type Chapter = {
  id: string
  subject: string
  name: string
  code: string | null
  board: string | null
  classLevel: string | null
  program: { id: string; name: string } | null
  expectedHours: number | null
  conceptCount: number
}

export type Concept = { id: string; chapterId: string; name: string; code: string | null }

export type MasterRow = {
  chapterId: string
  subject: string
  chapterName: string
  chapterCode: string | null
  board: string | null
  classLevel: string | null
  program: string | null
  expectedHours: number | null
  conceptId: string | null
  conceptName: string | null
  conceptCode: string | null
}

export type MasterFilters = { board: string; classLevel: string; programId: string; subject: string }

/** The 8 Master Sheet fields (PRD §4.3), also the import/export column headers. */
export const MASTER_FIELDS = [
  'Chapter Name',
  'Chapter Code',
  'Board',
  'Class',
  'Program',
  'Expected Hours',
  'Concept Name',
  'Concept Code',
] as const

const base = (schoolId: string) => `/schools/${schoolId}/curriculum`
export const curriculumKey = (schoolId: string) => [schoolId, 'curriculum'] as const

export function useCurriculumOptions(schoolId: string) {
  return useQuery({
    queryKey: [...curriculumKey(schoolId), 'options'],
    queryFn: () => api<CurriculumOptions>(`${base(schoolId)}/options`),
  })
}

export function useChapters(schoolId: string, subject: string) {
  return useQuery({
    queryKey: [...curriculumKey(schoolId), 'chapters', subject],
    queryFn: () => api<Chapter[]>(`${base(schoolId)}/chapters?subject=${encodeURIComponent(subject)}`),
    enabled: !!subject,
  })
}

export function useConcepts(schoolId: string, chapterId: string | null) {
  return useQuery({
    queryKey: [...curriculumKey(schoolId), 'concepts', chapterId],
    queryFn: () => api<Concept[]>(`${base(schoolId)}/chapters/${chapterId}/concepts`),
    enabled: !!chapterId,
  })
}

export function useMasterSheet(schoolId: string, filters: MasterFilters) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v))
  return useQuery({
    queryKey: [...curriculumKey(schoolId), 'master', filters],
    queryFn: () => api<MasterRow[]>(`${base(schoolId)}/master?${params}`),
  })
}

/** Refetches every curriculum query of the school after a change. */
export function useRefreshCurriculum(schoolId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: curriculumKey(schoolId) })
}

export const curriculumApi = {
  createChapter: (schoolId: string, body: unknown) =>
    api<Chapter>(`${base(schoolId)}/chapters`, { method: 'POST', body: JSON.stringify(body) }),
  updateChapter: (schoolId: string, id: string, body: unknown) =>
    api<Chapter>(`${base(schoolId)}/chapters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteChapter: (schoolId: string, id: string) => api(`${base(schoolId)}/chapters/${id}`, { method: 'DELETE' }),
  createConcept: (schoolId: string, chapterId: string, body: unknown) =>
    api<Concept>(`${base(schoolId)}/chapters/${chapterId}/concepts`, { method: 'POST', body: JSON.stringify(body) }),
  updateConcept: (schoolId: string, id: string, body: unknown) =>
    api<Concept>(`${base(schoolId)}/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteConcept: (schoolId: string, id: string) => api(`${base(schoolId)}/concepts/${id}`, { method: 'DELETE' }),
  importRows: <T>(schoolId: string, body: unknown) =>
    api<T>(`${base(schoolId)}/import`, { method: 'POST', body: JSON.stringify(body) }),
}
