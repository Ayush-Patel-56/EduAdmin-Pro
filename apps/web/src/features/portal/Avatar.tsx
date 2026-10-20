import { useState } from 'react'
import type { Me } from '@/features/auth/types'

/** The account's profile picture, or its initial on a coloured circle (also when the picture fails to load). */
export function Avatar({ me, className }: { me: Pick<Me, 'fullName' | 'avatarUrl'>; className: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const initial = me.fullName.trim().charAt(0).toUpperCase()
  const src = me.avatarUrl && failed !== me.avatarUrl ? me.avatarUrl : null
  return src ? (
    <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(src)} className={`${className} object-cover`} />
  ) : (
    <span aria-hidden="true" className={`${className} flex items-center justify-center font-semibold text-white`}>
      {initial}
    </span>
  )
}
