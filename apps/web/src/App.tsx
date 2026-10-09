import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { PlaceholderPage } from '@/features/auth/PlaceholderPage'
import { SignupRolePage } from '@/features/auth/SignupRolePage'

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupRolePage /> },
  { path: '/signup/teacher', element: <PlaceholderPage title="Teacher sign up" /> },
  { path: '/signup/admin', element: <PlaceholderPage title="Administration sign up" /> },
  { path: '/verify-email', element: <PlaceholderPage title="Verify email" /> },
  { path: '/forgot-password', element: <PlaceholderPage title="Forgot password" /> },
  { path: '*', element: <Navigate to="/login" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
