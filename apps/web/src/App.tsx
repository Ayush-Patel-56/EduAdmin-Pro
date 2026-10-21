import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from '@/routes'

let router: ReturnType<typeof createBrowserRouter> | undefined

export default function App() {
  router ??= createBrowserRouter(routes)
  return <RouterProvider router={router} />
}
