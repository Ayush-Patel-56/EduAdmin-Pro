import { Link } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AuthLayout>
      <div className="rounded-3xl bg-white p-10 text-center shadow-lg">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Coming soon.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
          Back to login
        </Link>
      </div>
    </AuthLayout>
  )
}
