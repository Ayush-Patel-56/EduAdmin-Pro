import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { PlaceholderPage } from '@/features/auth/PlaceholderPage'
import { HomeRedirect, RequireAuth } from '@/features/auth/guards'
import { AdminSignupPage, TeacherSignupPage } from '@/features/auth/SignupPages'
import { SignupRolePage } from '@/features/auth/SignupRolePage'
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { DashboardPage } from '@/features/admin/DashboardPage'
import { adminNav } from '@/features/admin/nav'
import { SectionPlaceholder } from '@/features/portal/SectionPlaceholder'
import { CreateSchoolPage } from '@/features/onboarding/CreateSchoolPage'
import { JoinSchoolPage } from '@/features/onboarding/JoinSchoolPage'
import { OnboardingPage } from '@/features/onboarding/OnboardingPage'
import { SetupCompletePage } from '@/features/onboarding/SetupCompletePage'
import { teacherExtraSections, teacherNav } from '@/features/teacher/nav'
import { TeacherDashboardPage } from '@/features/teacher/TeacherDashboardPage'
import { TeacherLayout } from '@/features/teacher/TeacherLayout'

const adminOnly = (element: ReactNode) => <RequireAuth accountType="ADMIN">{element}</RequireAuth>
const teacherOnly = (element: ReactNode) => <RequireAuth accountType="TEACHER">{element}</RequireAuth>

// Sections reachable from the dashboard that aren't in the sidebar.
const extraSections = [
  { path: 'announcements', label: 'Announcements' },
  { path: 'schedule', label: 'Class Schedule' },
]

const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupRolePage /> },
  { path: '/signup/teacher', element: <TeacherSignupPage /> },
  { path: '/signup/admin', element: <AdminSignupPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <PlaceholderPage title="Forgot password" /> },

  { path: '/onboarding', element: adminOnly(<OnboardingPage />) },
  { path: '/onboarding/create', element: adminOnly(<CreateSchoolPage />) },
  { path: '/onboarding/join', element: adminOnly(<JoinSchoolPage backTo="/onboarding" after="confirm" />) },
  { path: '/onboarding/done', element: adminOnly(<SetupCompletePage />) },

  {
    path: '/dashboard',
    element: adminOnly(<AdminLayout />),
    children: [
      { index: true, element: <DashboardPage /> },
      ...[...adminNav.filter((n) => n.path), ...extraSections].map((n) => ({
        path: n.path,
        element: <SectionPlaceholder title={n.label} />,
      })),
    ],
  },

  {
    path: '/teacher',
    element: teacherOnly(<TeacherLayout />),
    children: [
      { index: true, element: <TeacherDashboardPage /> },
      ...[...teacherNav.filter((n) => n.path), ...teacherExtraSections].map((n) => ({
        path: n.path,
        element: <SectionPlaceholder title={n.label} />,
      })),
    ],
  },
  { path: '/teacher/join', element: teacherOnly(<JoinSchoolPage backTo="/teacher" after="teacher-portal" />) },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
