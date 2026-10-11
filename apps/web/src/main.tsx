import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { setUnauthorizedHandler } from './lib/api'
import { meQueryKey } from './features/auth/session'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false },
  },
})

// Session expired mid-use: drop every cached school/portal response, then
// re-check the session. The guards see the 401 from /auth/me and send the
// user to /login.
setUnauthorizedHandler(() => {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] })
  void queryClient.resetQueries({ queryKey: meQueryKey })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
