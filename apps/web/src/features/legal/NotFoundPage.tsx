import { Link } from 'react-router-dom'

/** Any address the app doesn't have. Not indexed, so search results never show a copy of the home page under a wrong URL. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <title>Page not found · EduAdmin Pro</title>
      <meta name="robots" content="noindex" />
      <p className="text-sm font-bold tracking-wider text-slate-400 uppercase">404</p>
      <h1 className="text-2xl font-bold text-slate-900">This page doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-slate-500">The link may be mistyped or out of date.</p>
      <Link to="/" className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
        Go to the home page
      </Link>
    </div>
  )
}
