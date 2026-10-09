import type { ReactNode } from 'react'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top_left,#e4e7fb,transparent_60%),radial-gradient(ellipse_at_bottom_right,#e7e3fa,transparent_60%)] px-4 py-10">
      {children}
    </main>
  )
}
