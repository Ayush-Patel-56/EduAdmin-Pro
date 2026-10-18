import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { PlaceholderPage } from '@/features/auth/PlaceholderPage'
import { HomeRedirect, PageSpinner, RequireAuth } from '@/features/auth/guards'
import { AdminSignupPage, TeacherSignupPage } from '@/features/auth/SignupPages'
import { SignupRolePage } from '@/features/auth/SignupRolePage'
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { DashboardPage } from '@/features/admin/DashboardPage'
import { adminExtraSections, adminNav, legacyAdminTarget } from '@/features/admin/nav'
import { RouteError } from '@/features/portal/RouteError'
import { SectionPlaceholder } from '@/features/portal/SectionPlaceholder'
import { CreateSchoolPage } from '@/features/onboarding/CreateSchoolPage'
import { JoinSchoolPage } from '@/features/onboarding/JoinSchoolPage'
import { OnboardingPage } from '@/features/onboarding/OnboardingPage'
import { SetupCompletePage } from '@/features/onboarding/SetupCompletePage'
import { legacyTeacherPaths, teacherExtraSections, teacherNav } from '@/features/teacher/nav'
import { TeacherDashboardPage } from '@/features/teacher/TeacherDashboardPage'
import { TeacherLayout } from '@/features/teacher/TeacherLayout'

// Heavy pages load on first visit instead of in the initial bundle.
const AcademicPlanningPage = lazy(() =>
  import('@/features/admin/planning/AcademicPlanningPage').then((m) => ({ default: m.AcademicPlanningPage })),
)
const CurriculumPage = lazy(() =>
  import('@/features/admin/curriculum/CurriculumPage').then((m) => ({ default: m.CurriculumPage })),
)
const RecruitmentPage = lazy(() =>
  import('@/features/admin/recruitment/RecruitmentPage').then((m) => ({ default: m.RecruitmentPage })),
)
const StudentsPage = lazy(() => import('@/features/admin/students/StudentsPage').then((m) => ({ default: m.StudentsPage })))
const TeacherStudentsPage = lazy(() =>
  import('@/features/teacher/TeacherStudentsPage').then((m) => ({ default: m.TeacherStudentsPage })),
)
const TeacherPortalPage = lazy(() =>
  import('@/features/admin/teacher-portal/TeacherPortalPage').then((m) => ({ default: m.TeacherPortalPage })),
)
const CounselingPage = lazy(() => import('@/features/admin/counseling/CounselingPage').then((m) => ({ default: m.CounselingPage })))
const WorkspacePage = lazy(() => import('@/features/teacher/workspace/WorkspacePage').then((m) => ({ default: m.WorkspacePage })))
const CounselingLogPage = lazy(() => import('@/features/teacher/CounselingLogPage').then((m) => ({ default: m.CounselingLogPage })))
const MyProfilePage = lazy(() => import('@/features/teacher/MyProfilePage').then((m) => ({ default: m.MyProfilePage })))
const TeacherAcademicPlanningPage = lazy(() =>
  import('@/features/teacher/TeacherAcademicPlanningPage').then((m) => ({ default: m.TeacherAcademicPlanningPage })),
)
const CalendarPage = lazy(() => import('@/features/admin/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const AttendanceOverviewPage = lazy(() =>
  import('@/features/admin/attendance/AttendanceOverviewPage').then((m) => ({ default: m.AttendanceOverviewPage })),
)
const SchedulePage = lazy(() => import('@/features/teacher/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const TeacherAttendancePage = lazy(() => import('@/features/teacher/AttendancePage').then((m) => ({ default: m.AttendancePage })))
const DailyReportsPage = lazy(() => import('@/features/admin/daily-reports/DailyReportsPage').then((m) => ({ default: m.DailyReportsPage })))
const DailyReportPage = lazy(() => import('@/features/teacher/DailyReportPage').then((m) => ({ default: m.DailyReportPage })))
const FeedbackPage = lazy(() => import('@/features/admin/feedback/FeedbackPage').then((m) => ({ default: m.FeedbackPage })))
const TeacherFeedbackPage = lazy(() => import('@/features/teacher/FeedbackPage').then((m) => ({ default: m.TeacherFeedbackPage })))
const PtmNotesPage = lazy(() => import('@/features/teacher/PtmNotesPage').then((m) => ({ default: m.PtmNotesPage })))
const FeesPage = lazy(() => import('@/features/admin/fees/FeesPage').then((m) => ({ default: m.FeesPage })))
const MeetingsPage = lazy(() => import('@/features/admin/meetings/MeetingsPage').then((m) => ({ default: m.MeetingsPage })))
const TestsBankPage = lazy(() => import('@/features/admin/tests/TestsBankPage').then((m) => ({ default: m.TestsBankPage })))
const TeacherTestsPage = lazy(() => import('@/features/teacher/TestsPage').then((m) => ({ default: m.TestsPage })))
const AcademicRecordsPage = lazy(() => import('@/features/teacher/AcademicRecordsPage').then((m) => ({ default: m.AcademicRecordsPage })))
const lazyPage = (page: ReactNode) => <Suspense fallback={<PageSpinner />}>{page}</Suspense>

const adminOnly = (element: ReactNode) => <RequireAuth accountType="ADMIN">{element}</RequireAuth>
const adminPages: Record<string, ReactNode> = {
  'academic-planning': lazyPage(<AcademicPlanningPage />),
  curriculum: lazyPage(<CurriculumPage />),
  recruitment: lazyPage(<RecruitmentPage />),
  students: lazyPage(<StudentsPage />),
  'teacher-portal': lazyPage(<TeacherPortalPage />),
  counseling: lazyPage(<CounselingPage />),
  calendar: lazyPage(<CalendarPage />),
  attendance: lazyPage(<AttendanceOverviewPage />),
  'fee-management': lazyPage(<FeesPage />),
  meetings: lazyPage(<MeetingsPage />),
  'daily-reports': lazyPage(<DailyReportsPage />),
  feedback: lazyPage(<FeedbackPage />),
  'tests-bank': lazyPage(<TestsBankPage />),
  // The dashboard's "Manage Schedule" used to point here; class schedules live under Calendar.
  schedule: <Navigate to="/management/calendar?tab=schedules" replace />,
}
const teacherPages: Record<string, ReactNode> = {
  'academic-planning': lazyPage(<TeacherAcademicPlanningPage />),
  students: lazyPage(<TeacherStudentsPage />),
  courses: lazyPage(<WorkspacePage />),
  assignments: lazyPage(<WorkspacePage />),
  'counseling-log': lazyPage(<CounselingLogPage />),
  schedule: lazyPage(<SchedulePage />),
  attendance: lazyPage(<TeacherAttendancePage />),
  'daily-report': lazyPage(<DailyReportPage />),
  feedback: lazyPage(<TeacherFeedbackPage />),
  'ptm-notes': lazyPage(<PtmNotesPage />),
  tests: lazyPage(<TeacherTestsPage />),
  'academic-records': lazyPage(<AcademicRecordsPage />),
  profile: lazyPage(<MyProfilePage />),
}
const teacherOnly = (element: ReactNode) => <RequireAuth accountType="TEACHER">{element}</RequireAuth>

/** Sends /dashboard/fees → /management/fee-management and the like. */
function LegacyAdminRedirect() {
  return <Navigate to={legacyAdminTarget(useParams()['*'] ?? '')} replace />
}

const router = createBrowserRouter([
  {
    // Any render or loader error below shows a recovery screen instead of a blank page.
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupRolePage /> },
      { path: '/signup/teacher', element: <TeacherSignupPage /> },
      { path: '/signup/admin', element: <AdminSignupPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <PlaceholderPage title="Forgot password" /> },

      { path: '/onboarding', element: adminOnly(<OnboardingPage />) },
      { path: '/onboarding/create', element: adminOnly(<CreateSchoolPage />) },
      { path: '/onboarding/join', element: adminOnly(<JoinSchoolPage />) },
      { path: '/onboarding/done', element: adminOnly(<SetupCompletePage />) },

      {
        path: '/management',
        element: adminOnly(<AdminLayout />),
        children: [
          { index: true, element: <DashboardPage /> },
          ...[...adminNav.filter((n) => n.path), ...adminExtraSections].map((n) => ({
            path: n.path,
            element: adminPages[n.path] ?? <SectionPlaceholder title={n.label} />,
          })),
        ],
      },
      { path: '/dashboard/*', element: <LegacyAdminRedirect /> },

      {
        path: '/teacher',
        element: teacherOnly(<TeacherLayout />),
        children: [
          { index: true, element: <TeacherDashboardPage /> },
          ...[...teacherNav.filter((n) => n.path), ...teacherExtraSections].map((n) => ({
            path: n.path,
            element: teacherPages[n.path] ?? <SectionPlaceholder title={n.label} />,
          })),
          ...Object.entries(legacyTeacherPaths).map(([from, to]) => ({
            path: from,
            element: <Navigate to={`/teacher/${to}`} replace />,
          })),
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
