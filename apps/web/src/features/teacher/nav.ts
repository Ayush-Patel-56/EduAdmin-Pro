import {
  Award,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  FileText,
  GraduationCap,
  HeartHandshake,
  LayoutGrid,
  MessageSquare,
  MessageSquareText,
  SquareCheckBig,
  Users,
} from 'lucide-react'
import type { NavItem } from '@/features/portal/PortalShell'

// `path` is relative to /teacher; '' is the portal home.
export const teacherNav: NavItem[] = [
  { path: '', label: 'Dashboard', icon: LayoutGrid },
  { path: 'schedule', label: 'Schedule', icon: CalendarDays },
  { path: 'academic-planning', label: 'Academic Planning', icon: GraduationCap },
  { path: 'student-reports', label: 'Student Reports', icon: ClipboardList },
  { path: 'students', label: 'Students', icon: Users },
  { path: 'daily-class-report', label: 'Daily Class Report', icon: ClipboardCheck },
  { path: 'student-ratings', label: 'Student Ratings', icon: Award },
  { path: 'ptm-notes', label: 'PTM Notes', icon: MessageSquare },
  { path: 'study-material', label: 'Study Material', icon: BookOpen },
  { path: 'attendance', label: 'Attendance', icon: SquareCheckBig },
  { path: 'tests', label: 'Tests & Question Bank', icon: FileQuestion },
  { path: 'academic-records', label: 'Academic Records', icon: FileText },
  { path: 'feedback', label: 'Feedback', icon: MessageSquareText },
  { path: 'counseling-log', label: 'Counseling Log', icon: HeartHandshake },
]

// Reachable from dashboard buttons but not listed in the sidebar.
export const teacherExtraSections = [
  { path: 'class-notes', label: 'Class Notes' },
  { path: 'assignments', label: 'Assignments' },
  { path: 'profile', label: 'My Profile' },
]
