import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { PlaceholderPage } from '@/features/auth/PlaceholderPage'
import { AdminSignupPage, TeacherSignupPage } from '@/features/auth/SignupPages'
import { SignupRolePage } from '@/features/auth/SignupRolePage'
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'
import { HomePage } from '@/features/home/HomePage'

const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupRolePage /> },
  { path: '/signup/teacher', element: <TeacherSignupPage /> },
  { path: '/signup/admin', element: <AdminSignupPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <PlaceholderPage title="Forgot password" /> },
  { path: '*', element: <Navigate to="/login" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
