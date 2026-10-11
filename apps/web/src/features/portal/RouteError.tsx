import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'

/** Shown when a page throws while rendering, so the app never goes blank. */
export function RouteError() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <TriangleAlert className="mx-auto size-8 text-amber-500" />
        <h1 className="mt-4 text-lg font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">This page hit an unexpected error. Reloading usually fixes it.</p>
        {import.meta.env.DEV && detail && (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-50 p-3 text-left text-[11px] whitespace-pre-wrap text-red-700">
            {detail}
          </pre>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-10 rounded-lg bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-hover"
          >
            Reload page
          </button>
          <a
            href="/"
            className="flex h-10 items-center rounded-lg border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  )
}
