// Mirrors the API's GET /auth/me response.
export type AccountType = 'ADMIN' | 'TEACHER'
export type Role = 'ADMIN' | 'TEACHER'
export type MembershipStatus = 'PENDING' | 'ACTIVE' | 'REVOKED'

export type Membership = {
  schoolId: string
  schoolName: string
  role: Role
  status: MembershipStatus
}

export type Me = {
  id: string
  email: string
  fullName: string
  accountType: AccountType
  emailVerified: boolean
  activeSchoolId: string | null
  memberships: Membership[]
}

export const firstName = (me: Pick<Me, 'fullName'>) => me.fullName.trim().split(/\s+/)[0]

export const adminSchools = (me: Me) =>
  me.memberships.filter((m) => m.role === 'ADMIN' && m.status === 'ACTIVE')
