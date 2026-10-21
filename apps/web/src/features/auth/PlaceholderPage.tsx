import { Link } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AuthLayout>
      <div className="au-card au-solo">
        <div className="au-form au-done">
          <div>
        <h1>{title}</h1>
        <p className="au-sub">Coming soon. Need help now? Email academicplanningsystem@gmail.com.</p>
        <Link to="/login" viewTransition className="au-cta-dark">
          Back to login
        </Link>
          </div>
        </div>
      </div>
    </AuthLayout>
  )
}
