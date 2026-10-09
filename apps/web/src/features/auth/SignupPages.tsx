import { Building2, Hash, Lock, Mail, User } from 'lucide-react'
import { SignupForm, type SignupField } from './SignupForm'

const toUpper = (value: string) => value.toUpperCase()

const teacherFields: SignupField[] = [
  { name: 'fullName', label: 'Full name', icon: User, autoComplete: 'name', required: true },
  { name: 'email', label: 'Institutional email', icon: Mail, type: 'email', autoComplete: 'email', required: true },
  { name: 'password', label: 'Password (min. 8 chars)', type: 'password', autoComplete: 'new-password', required: true },
  { name: 'department', label: 'Department (optional)', icon: Building2 },
  { name: 'schoolCode', label: 'School join code (e.g. EDUA-4821)', icon: Hash, required: true, transform: toUpper },
]

const adminFields: SignupField[] = [
  { name: 'fullName', label: 'Full name', icon: User, autoComplete: 'name', required: true },
  { name: 'email', label: 'Email', icon: Mail, type: 'email', autoComplete: 'email', required: true },
  { name: 'password', label: 'Password (min. 8 chars)', type: 'password', autoComplete: 'new-password', required: true },
  { name: 'employeeId', label: 'Employee ID (optional)', icon: Building2 },
  { name: 'inviteCode', label: 'Admin invite code', icon: Lock, required: true, transform: toUpper },
]

export function TeacherSignupPage() {
  return <SignupForm title="Teacher Sign Up" endpoint="/auth/signup/teacher" fields={teacherFields} />
}

export function AdminSignupPage() {
  return (
    <SignupForm
      title="Administration Sign Up"
      endpoint="/auth/signup/admin"
      fields={adminFields}
      hint="You'll create or join your school right after signing in."
    />
  )
}
