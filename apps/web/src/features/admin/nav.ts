import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileQuestion,
  GraduationCap,
  HeartHandshake,
  LayoutGrid,
  MessageSquare,
  ScrollText,
  UserCircle,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = { path: string; label: string; icon: LucideIcon }

// `path` is relative to /management; '' is the dashboard home.
export const adminNav: NavItem[] = [
  { path: '', label: 'Dashboard', icon: LayoutGrid },
  { path: 'academic-planning', label: 'Academic Planning', icon: BookOpen },
  { path: 'curriculum', label: 'Curriculum', icon: ScrollText },
  { path: 'recruitment', label: 'Recruitment', icon: UserPlus },
  { path: 'student-reports', label: 'Student Reports', icon: BarChart3 },
  { path: 'students', label: 'Students', icon: GraduationCap },
  { path: 'teacher-portal', label: 'Teacher Portal', icon: UserCircle },
  { path: 'daily-reports', label: 'Daily Reports', icon: ClipboardList },
  { path: 'fee-management', label: 'Fee Management', icon: CreditCard },
  { path: 'tests-bank', label: 'Tests & Question Bank', icon: FileQuestion },
  { path: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { path: 'feedback', label: 'Feedback', icon: MessageSquare },
  { path: 'counseling', label: 'Counseling', icon: HeartHandshake },
  { path: 'meetings', label: 'Meetings', icon: Users },
  { path: 'calendar', label: 'Calendar', icon: CalendarDays },
]

// Reachable from the dashboard but not listed in the sidebar.
export const adminExtraSections = [
  { path: 'announcements', label: 'Announcements' },
  { path: 'schedule', label: 'Class Schedule' },
]

// Admin paths before the PRD route names; old links redirect to the new ones.
export const legacyAdminPaths: Record<string, string> = {
  fees: 'fee-management',
  tests: 'tests-bank',
}
