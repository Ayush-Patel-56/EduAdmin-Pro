// Mirrors the API's GET /auth/me response.
export type Role = 'ADMIN' | 'TEACHER'
export type MembershipStatus = 'PENDING' | 'ACTIVE' | 'REVOKED'

export type Me = {
  id: string
  email: string
  fullName: string
  activeSchoolId: string | null
  canCreateSchool: boolean
  memberships: {
    schoolId: string
    schoolName: string
    role: Role
    status: MembershipStatus
  }[]
}
