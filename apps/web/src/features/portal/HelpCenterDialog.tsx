import { BarChart3, BookOpen, FileUp, Mail, type LucideIcon } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'

export const SUPPORT_EMAIL = 'academicplanningsystem@gmail.com'

const topics: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: BookOpen,
    title: 'Academic Planning',
    body: 'Set up programs and batches, then track syllabus coverage chapter by chapter. Status changes made by faculty appear for management too.',
  },
  {
    icon: FileUp,
    title: 'Uploading Student Reports',
    body: 'Pick the class, subject and term, then upload an Excel or CSV sheet (up to 1,000 students) with Name, RollNo, Marks and MaxMarks. Grades are calculated for you.',
  },
  {
    icon: BarChart3,
    title: 'Performance Analytics',
    body: 'The 5-in-1 student report combines test results, topic strengths, mistakes, ratings, attendance and PTM notes into one view per student.',
  },
]

export function HelpCenterDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Help Center" description="Guides for the most common tasks" onClose={onClose}>
      <ul className="space-y-3 px-6 py-5">
        {topics.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3 rounded-xl border border-slate-200 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
        <Mail className="size-4 shrink-0 text-slate-500" />
        <p className="text-xs text-slate-600">
          Still stuck? Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-brand-600 hover:underline">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </Dialog>
  )
}
