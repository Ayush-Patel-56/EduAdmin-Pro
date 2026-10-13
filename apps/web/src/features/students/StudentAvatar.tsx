import { useState } from 'react'
import { initials } from './api'

/** A person's photo, or their initials when there is none (or it fails to load). */
export function StudentAvatar({
  name,
  photoUrl,
  size = 'size-9 text-xs',
  tone = 'bg-violet-100 text-violet-700',
}: {
  name: string
  photoUrl: string | null
  size?: string
  /** Background and text colour of the initials. */
  tone?: string
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  if (photoUrl && photoUrl !== brokenUrl) {
    return <img src={photoUrl} alt="" onError={() => setBrokenUrl(photoUrl)} className={`${size} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full font-bold ${tone}`}>
      {initials(name)}
    </span>
  )
}
