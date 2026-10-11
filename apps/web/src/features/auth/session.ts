import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { adminSchools, type Me } from './types'

export const meQueryKey = ['me'] as const

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: () => api<Me>('/auth/me') })
}

export function useLogout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => null)
    queryClient.clear()
    navigate('/login', { replace: true })
  }
}

/** Where a signed-in user belongs right now. */
export function homePath(me: Me) {
  if (me.accountType === 'TEACHER') return '/teacher'
  return adminSchools(me).length > 0 ? '/management' : '/onboarding'
}
