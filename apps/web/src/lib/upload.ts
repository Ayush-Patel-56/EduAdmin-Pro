import { api } from './api'

export type FilePurpose = 'STUDENT_PHOTO'

export type UploadedFile = { id: string; name: string; contentType: string; size: number; url: string | null }

type Ticket = { fileId: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }

/** What each upload accepts; mirrors the API's rules so mistakes show before uploading. */
export const UPLOAD_RULES: Record<FilePurpose, { accept: string; types: string[]; maxBytes: number; describe: string }> = {
  STUDENT_PHOTO: {
    accept: 'image/jpeg,image/png,image/webp',
    types: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
    describe: 'a JPG, PNG or WebP image up to 2 MB',
  },
}

/** A problem with the chosen file, or null if it can be uploaded. */
export function checkFile(purpose: FilePurpose, file: File): string | null {
  const rule = UPLOAD_RULES[purpose]
  if (!rule.types.includes(file.type)) return `Choose ${rule.describe}`
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
    body: JSON.stringify({ purpose, name: file.name, contentType: file.type, size: file.size }),
  })
  await put(ticket.upload.url, ticket.upload.headers, file, onProgress)
  return api<UploadedFile>(`/schools/${schoolId}/files/${ticket.fileId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ purpose }),
  })
}
