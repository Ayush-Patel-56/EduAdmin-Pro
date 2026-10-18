import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorBanner } from '@/components/ui/form'
import { btnPrimary, btnSecondary, inputClass } from '@/components/ui/formStyles'
import { answerLabel, LETTERS, previewScore, quickFill, type PaperQuestion } from './api'
import { TypeBadge } from './ui'

type Props = {
  student: { fullName: string; rollNumber: string | null }
  paper: PaperQuestion[]
  totalMarks: number
  answers: Record<string, string>
  readOnly: boolean
  onApply: (answers: Record<string, string>) => void
  onClose: () => void
}

/** One student's answers, question by question (what topic strength and mistake reports read). */
export function AnswersDialog({ student, paper, totalMarks, answers: initial, readOnly, onApply, onClose }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(initial)
  const [quick, setQuick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const set = (id: string, value: string) => setAnswers((a) => ({ ...a, [id]: value }))
  const preview = previewScore(paper, answers)

  function fill() {
    const out = quickFill(paper, quick)
    if (typeof out === 'string') return setError(out)
    setError(null)
    setAnswers(out)
  }

  return (
    <Dialog title={`Answers: ${student.fullName}`} description={`${student.rollNumber ? `Roll ${student.rollNumber} · ` : ''}${paper.length} questions · out of ${totalMarks}`} onClose={onClose} widthClass="max-w-3xl">
      <div className="space-y-4 px-6 py-5">
        {!readOnly && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label htmlFor="quick" className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Quick fill
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input id="quick" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Answers in order, e.g. B, C, 42, -, 3  (- = left blank)" className={inputClass()} />
              <button type="button" onClick={fill} disabled={!quick.trim()} className={`${btnSecondary} shrink-0`}>
                Fill
              </button>
            </div>
          </div>
        )}
        <ErrorBanner message={error} />
        <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {paper.map((q, i) => {
            const v = answers[q.id] ?? ''
            return (
              <li key={q.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-slate-800 [overflow-wrap:anywhere]" title={q.text}>
                    <span className="font-bold text-slate-500">Q{i + 1}.</span> {q.text}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <TypeBadge value={q.type} /> +{q.marks}
                    {q.negativeMarks ? ` / −${q.negativeMarks}` : ''} · Key: <span className="font-semibold text-emerald-700">{q.type === 'SUBJECTIVE' ? 'teacher-marked' : answerLabel(q)}</span>
                  </p>
                </div>
                <div className="shrink-0">
                  {q.type === 'MCQ' ? (
                    <div role="radiogroup" aria-label={`Q${i + 1} answer`} className="flex gap-1">
                      {LETTERS.map((l) => (
                        <button
                          key={l}
                          type="button"
                          role="radio"
                          aria-checked={v === l}
                          disabled={readOnly}
                          onClick={() => set(q.id, v === l ? '' : l)}
                          className={`size-9 rounded-lg border text-sm font-bold transition disabled:cursor-not-allowed ${v === l ? 'border-ink bg-ink text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Q${i + 1} ${q.type === 'SUBJECTIVE' ? 'marks given' : 'answer'}`}
                        inputMode="decimal"
                        value={v}
                        disabled={readOnly}
                        onChange={(e) => set(q.id, e.target.value)}
                        placeholder={q.type === 'SUBJECTIVE' ? 'Marks' : 'Answer'}
                        className="h-9 w-24 rounded-lg border border-slate-200 px-2.5 text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:bg-slate-50"
                      />
                      {q.type === 'SUBJECTIVE' && <span className="text-xs text-slate-400">/ {q.marks}</span>}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          {preview.answered} of {paper.length} answered · Preview: <span className="font-bold text-slate-900 tabular-nums">{preview.marks}</span> / {totalMarks}
        </p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={btnSecondary}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                onApply(Object.fromEntries(Object.entries(answers).filter(([, a]) => a.trim())))
                onClose()
              }}
              className={btnPrimary}
            >
              Apply
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
