import { useState } from 'react'
import { ArrowLeft, Ban, ClipboardList, FileDown, FileQuestion, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/form'
import { formatDay } from '@/features/portal/format'
import { durationLabel, time12, useInvalidateAssessments, useTestDetail, type Options } from './api'
import { PaperBuilder } from './PaperBuilder'
import { paperPdf } from './pdf'
import { ResultsSheet } from './ResultsSheet'
import { TestActionConfirm } from './TestsTable'
import { TestDialog } from './TestDialog'
import { PhaseBadge, Spinner, Tabs, TestTypeBadge } from './ui'

type View = 'paper' | 'results'

/** One test: its paper and its results. */
export function TestWorkspace({ base, testId, options, institute, onBack }: { base: string; testId: string; options: Options; institute: string; onBack: () => void }) {
  const detail = useTestDetail(base, testId)
  const invalidate = useInvalidateAssessments(base)
  const [view, setView] = useState<View | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'cancel' | 'restore' | 'delete' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const d = detail.data

  const back = (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
      <ArrowLeft className="size-4" /> Back to tests
    </button>
  )
  if (detail.error) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorBanner message={detail.error.message} />
      </div>
    )
  }
  if (!d) return <Spinner />
  const t = d.test
  const shown: View = view ?? (t.phase === 'ONGOING' || t.phase === 'COMPLETED' ? 'results' : 'paper')

  async function exportPaper() {
    setExportError(null)
    try {
      const doc = await paperPdf(
        { institute, title: t.title, subject: t.subject, date: formatDay(t.date), duration: durationLabel(t.durationMinutes), totalMarks: String(t.totalMarks), instructions: '' },
        d!.paper.questions,
        { showMarks: true, answerKey: false },
      )
      doc.save(`${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'paper'}.pdf`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not make the PDF')
    }
  }

  return (
    <div className="space-y-5">
      {back}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 [overflow-wrap:anywhere]">{t.title}</h2>
            <PhaseBadge value={t.phase} />
            <TestTypeBadge value={t.type} />
          </div>
          <p className="mt-1.5 text-sm text-slate-500">
            {t.batch.name} · {t.program.name} · {t.subject}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatDay(t.date)}, {time12(t.time)} IST · {durationLabel(t.durationMinutes)} · {t.totalMarks} marks · by {t.faculty.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.paper.questions.length > 0 && (
            <button type="button" onClick={() => void exportPaper()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <FileDown className="size-4" /> Paper PDF
            </button>
          )}
          {d.canEdit && (
            <>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Pencil className="size-4" /> Edit
              </button>
              {t.phase === 'CANCELLED' ? (
                <button type="button" onClick={() => setConfirm('restore')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <RotateCcw className="size-4" /> Restore
                </button>
              ) : (
                <button type="button" onClick={() => setConfirm('cancel')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-amber-700 hover:bg-amber-50">
                  <Ban className="size-4" /> Cancel Test
                </button>
              )}
              <button type="button" onClick={() => setConfirm('delete')} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-red-600 hover:bg-red-50">
                <Trash2 className="size-4" /> Delete
              </button>
            </>
          )}
        </div>
      </div>
      <ErrorBanner message={exportError} />

      <Tabs
        label="Test"
        value={shown}
        onChange={setView}
        tabs={[
          { key: 'paper', label: `Question Paper (${d.paper.questions.length})`, icon: FileQuestion },
          { key: 'results', label: `Results (${t.results})`, icon: ClipboardList },
        ]}
      />
      {shown === 'paper' ? <PaperBuilder base={base} detail={d} options={options} /> : <ResultsSheet base={base} testId={t.id} />}

      {editing && <TestDialog base={base} options={options} test={t} title="Edit Test" onSaved={invalidate} onClose={() => setEditing(false)} />}
      {confirm && (
        <TestActionConfirm
          base={base}
          test={t}
          action={confirm}
          onDone={async () => {
            if (confirm === 'delete') onBack()
            await invalidate()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
