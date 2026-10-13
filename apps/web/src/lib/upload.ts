import { api } from './api'

export type FilePurpose = 'STUDENT_PHOTO' | 'FACULTY_PHOTO' | 'STUDY_MATERIAL' | 'ASSIGNMENT_SHEET' | 'SUBMISSION'

export type UploadedFile = { id: string; name: string; contentType: string; size: number; url: string | null }

type Ticket = { fileId: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }

const MB = 1024 * 1024
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const IMAGES = ['image/jpeg', 'image/png', 'image/webp']
const photo = { accept: IMAGES.join(','), types: IMAGES, maxBytes: 2 * MB, describe: 'a JPG, PNG or WebP image up to 2 MB' }
const paper = {
  accept: `.pdf,.docx,${IMAGES.join(',')}`,
  types: ['application/pdf', DOCX, ...IMAGES],
  maxBytes: 10 * MB,
  describe: 'a PDF, DOCX or image up to 10 MB',
}

/** What each upload accepts; mirrors the API's rules so mistakes show before uploading. */
export const UPLOAD_RULES: Record<FilePurpose, { accept: string; types: string[]; maxBytes: number; describe: string }> = {
  STUDENT_PHOTO: photo,
  FACULTY_PHOTO: photo,
  STUDY_MATERIAL: {
    accept: '.pdf,.docx,.zip,.mp4',
    types: ['application/pdf', DOCX, 'application/zip', 'video/mp4'],
    maxBytes: 50 * MB,
    describe: 'a PDF, DOCX, ZIP or MP4 file up to 50 MB',
  },
  ASSIGNMENT_SHEET: paper,
  SUBMISSION: paper,
}

const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX,
  zip: 'application/zip',
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** The file's type, from the browser or its extension (some browsers leave .docx/.zip blank or odd). */
export function fileType(file: File): string {
  const reported = file.type === 'application/x-zip-compressed' ? 'application/zip' : file.type
  return reported || BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || ''
}

/** "1.4 MB" */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

/** A problem with the chosen file, or null if it can be uploaded. */
export function checkFile(purpose: FilePurpose, file: File): string | null {
  const rule = UPLOAD_RULES[purpose]
  if (!rule.types.includes(fileType(file))) return `Choose ${rule.describe}`
  if (file.size === 0) return 'The file is empty'
  if (file.size > rule.maxBytes) return `Choose ${rule.describe}`
  return null
}

function put(url: string, headers: Record<string, string>, file: File, onProgress?: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload failed. Try again.')))
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    xhr.send(file)
  })
}

/**
 * Uploads straight to storage: ask the API for a short-lived upload URL, PUT
 * the bytes there, then ask the API to check and confirm the file.
 */
export async function uploadFile(
  schoolId: string,
  purpose: FilePurpose,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedFile> {
  const problem = checkFile(purpose, file)
  if (problem) throw new Error(problem)
  const ticket = await api<Ticket>(`/schools/${schoolId}/files`, {
    method: 'POST',
    body: JSON.stringify({ purpose, name: file.name, contentType: fileType(file), size: file.size }),
  })
  await put(ticket.upload.url, ticket.upload.headers, file, onProgress)
  return api<UploadedFile>(`/schools/${schoolId}/files/${ticket.fileId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ purpose }),
  })
}
