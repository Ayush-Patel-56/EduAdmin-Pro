import { useState } from 'react'
import { initials } from './api'

/** The student's photo, or their initials when there is none (or it fails to load). */
export function StudentAvatar({ name, photoUrl, size = 'size-9 text-xs' }: { name: string; photoUrl: string | null; size?: string }) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  if (photoUrl && photoUrl !== brokenUrl) {
    // Imported photo links can point anywhere; don't tell those hosts which page asked.
    return <img src={photoUrl} alt="" referrerPolicy="no-referrer" onError={() => setBrokenUrl(photoUrl)} className={`${size} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-violet-100 font-bold text-violet-700`}>
      {initials(name)}
    </span>
  )
}
