import type { ReactNode } from 'react'
import { AlertTriangle, BookOpenCheck, CalendarCheck, ClipboardList, MessageSquareText, Star, Target, Users } from 'lucide-react'
import { BAND_LABELS, DIFFICULTY_LABELS, TYPE_LABELS, dayLabel, num, pct, type StudentReport, type TopicStrength } from './api'
import { Card, Empty, GradePill, Meter } from './ui'
import { toneOf } from './styles'

const th = 'px-3 py-2.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase'
const td = 'px-3 py-2.5'

/** 1. Performance Report: total marks, rank and percentile, grade, subject-wise breakdown and each test. */
export function PerformanceSection({ r }: { r: StudentReport }) {
  const s = r.summary
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total marks" value={s.marks === null ? '—' : `${num(s.marks)} / ${s.totalMarks}`} sub={`${s.testsTaken} test${s.testsTaken === 1 ? '' : 's'} sat${s.testsAbsent ? `, ${s.testsAbsent} absent (not counted)` : ''}`} />
        <Stat label="Overall" value={pct(s.overallPercent, 2)} sub={<GradePill grade={s.grade} />} />
        <Stat label="Batch rank" value={s.batchRank ? `#${s.batchRank.rank} of ${s.batchRank.of}` : '—'} sub={s.batchRank ? `Top ${s.batchRank.topPercent}% · ${s.batchRank.percentile} percentile` : 'Active students of the batch with tests this year'} />
        <Stat label="Accuracy" value={pct(s.accuracy)} sub={`Attempt rate ${pct(s.attemptRate)}`} />
      </div>
      <Card title="Subject-wise breakdown" sub="Tests sat this academic year, by the test's subject">
        {r.performance.subjects.length === 0 ? (
          <Empty icon={BookOpenCheck} title="No test results this year" sub="Results entered under Tests & Question Bank (or imported here) appear once the student has sat a test." />
        ) : (
          <div className="space-y-4">
            {r.performance.subjects.map((sub) => (
              <div key={sub.subject}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-slate-800">{sub.subject}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                    {num(sub.marks)} / {sub.totalMarks} · {pct(sub.percent)} <GradePill grade={sub.grade} />
                  </span>
                </div>
                <Meter value={sub.percent} tone={toneOf(sub.percent)} />
              </div>
            ))}
          </div>
        )}
      </Card>
      {r.performance.tests.length > 0 && (
        <Card title="Tests this year" sub="Rank and percentile among the students present">
          <div className="-m-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50"><tr><th className={th}>Test</th><th className={th}>Date</th><th className={th}>Marks</th><th className={th}>%</th><th className={th}>Grade</th><th className={th}>Rank</th><th className={th}>Percentile</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {r.performance.tests.map((t) => (
                  <tr key={t.id}>
                    <td className={td}><p className="font-semibold text-slate-800">{t.title}</p><p className="text-xs text-slate-500">{t.subject}</p></td>
                    <td className={`${td} text-xs whitespace-nowrap text-slate-600`}>{dayLabel(t.date)}</td>
                    <td className={`${td} tabular-nums`}>{t.present ? `${num(t.marks)} / ${t.totalMarks}` : <span className="text-xs font-semibold text-slate-400">Absent</span>}</td>
                    <td className={`${td} tabular-nums`}>{pct(t.percent)}</td>
                    <td className={td}><GradePill grade={t.grade} /></td>
                    <td className={`${td} tabular-nums`}>{t.rank ? `${t.rank} / ${t.of}` : '—'}</td>
                    <td className={`${td} tabular-nums`}>{t.percentile ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

/** 2. Test Analysis: accuracy, attempt rate, correct / incorrect, and by question type and difficulty. */
export function AnalysisSection({ r }: { r: StudentReport }) {
  const a = r.analysis
  if (a.questions === 0 && a.answered === 0)
    return <Empty icon={Target} title="No question counts yet" sub="Accuracy needs correct / incorrect counts or answers entered question by question on a test's results." />
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accuracy" value={pct(a.accuracy)} sub="Correct out of attempted" />
        <Stat label="Attempt rate" value={pct(a.attemptRate)} sub={`${a.attempted} of ${a.questions} questions`} />
        <Stat label="Correct" value={String(a.correct)} sub="Partly credited answers count as correct" />
        <Stat label="Incorrect" value={String(a.incorrect)} sub={`${a.unattempted} unattempted`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="Accuracy by question type" rows={a.byType.map((t) => ({ key: TYPE_LABELS[t.type] ?? t.type, ...t }))} />
        <Breakdown title="Accuracy by difficulty" rows={['EASY', 'MEDIUM', 'HARD'].flatMap((d) => a.byDifficulty.filter((x) => x.difficulty === d).map((x) => ({ key: DIFFICULTY_LABELS[d], ...x })))} />
      </div>
      <p className="text-[11px] text-slate-400">Totals use {a.testsCounted} test result{a.testsCounted === 1 ? '' : 's'} with counts; type and difficulty use the {a.answered} answer{a.answered === 1 ? '' : 's'} graded question by question.</p>
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; questions: number; correct: number; partial: number; incorrect: number; unattempted: number; accuracy: number | null; attemptRate: number | null }[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">Shown once a test's answers are entered question by question.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-800">{r.key}</span>
                <span className="text-xs text-slate-500 tabular-nums">{pct(r.accuracy)} · {r.correct + r.partial}/{r.correct + r.partial + r.incorrect} right · {r.unattempted} skipped</span>
              </div>
              <Meter value={r.accuracy} tone={toneOf(r.accuracy)} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** 3. Strength vs Weakness: topics from test answers and graded assignments, blended. */
export function TopicsSection({ r }: { r: StudentReport }) {
  const all = [...r.topics.strong, ...r.topics.average, ...r.topics.weak]
  if (!all.length)
    return <Empty icon={Target} title="No topic data yet" sub="Topics come from tests graded question by question and from graded assignments that name a chapter or topic." />
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        {(['STRONG', 'AVERAGE', 'WEAK'] as const).map((band) => {
          const list = band === 'STRONG' ? r.topics.strong : band === 'AVERAGE' ? r.topics.average : r.topics.weak
          return (
            <Card key={band} title={BAND_LABELS[band]} sub={bandCount(list.length, r.topics.counts?.[band === 'STRONG' ? 'strong' : band === 'AVERAGE' ? 'average' : 'weak'])}>
              {list.length === 0 ? <p className="text-xs text-slate-400">None</p> : <ul className="space-y-3">{list.map((t) => <TopicRow key={`${t.subject}|${t.topic}`} t={t} />)}</ul>}
            </Card>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-400">A topic's score is the mean of its test score (marks earned out of possible) and its assignment score, where it has both. Topics are matched by subject and name in any letter case.</p>
    </div>
  )
}

function TopicRow({ t }: { t: TopicStrength }) {
  return (
    <li>
      <div className="flex items-start justify-between gap-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-800" title={t.topic}>{t.topic}</p>
          <p className="truncate text-[11px] text-slate-500">{t.subject}{t.chapter && t.chapter !== t.topic ? ` · ${t.chapter}` : ''}</p>
        </div>
        <span className="shrink-0 text-sm font-bold text-slate-900 tabular-nums">{pct(t.percent)}</span>
      </div>
      <div className="mt-1.5"><Meter value={t.percent} tone={toneOf(t.percent)} /></div>
      <p className="mt-1 text-[11px] text-slate-500">
        {t.test ? `Tests ${pct(t.test.percent)} (${t.test.questions} question${t.test.questions === 1 ? '' : 's'})` : 'No test questions'}
        {' · '}
        {t.assignments ? `Assignments ${pct(t.assignments.percent)} (${t.assignments.count})` : 'No graded assignments'}
      </p>
    </li>
  )
}

/** 4. Error Logs: the mistake breakdown and recent incorrect answers. */
export function MistakesSection({ r }: { r: StudentReport }) {
  const m = r.mistakes
  if (m.incorrect + m.partial + m.unattempted === 0)
    return <Empty icon={AlertTriangle} title="No mistakes logged" sub="Mistakes are logged from tests whose answers are entered question by question." />
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Incorrect" value={String(m.incorrect)} sub="Wrong answers" />
        <Stat label="Partly correct" value={String(m.partial)} sub="Subjective answers given part marks" />
        <Stat label="Unattempted" value={String(m.unattempted)} sub="Questions left blank" />
      </div>
      {m.bySubject.length > 0 && (
        <Card title="Mistake history by subject">
          <div className="space-y-3">
            {m.bySubject.map((s) => {
              const total = s.incorrect + s.partial + s.unattempted
              return (
                <div key={s.subject} className="text-sm">
                  <div className="mb-1 flex justify-between"><span className="font-semibold text-slate-800">{s.subject}</span><span className="text-xs text-slate-500">{total} mistake{total === 1 ? '' : 's'}</span></div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="bg-rose-500" style={{ width: `${(s.incorrect / total) * 100}%` }} title={`${s.incorrect} incorrect`} />
                    <div className="bg-amber-400" style={{ width: `${(s.partial / total) * 100}%` }} title={`${s.partial} partly correct`} />
                    <div className="bg-slate-400" style={{ width: `${(s.unattempted / total) * 100}%` }} title={`${s.unattempted} unattempted`} />
                  </div>
                </div>
              )
            })}
            <p className="flex flex-wrap gap-3 pt-1 text-[11px] text-slate-500"><Legend tone="bg-rose-500" label="Incorrect" /><Legend tone="bg-amber-400" label="Partly correct" /><Legend tone="bg-slate-400" label="Unattempted" /></p>
          </div>
        </Card>
      )}
      <Card title="Recent incorrect question logs" sub={`The latest ${m.recent.length} wrong or partly correct answers`}>
        <ul className="-my-2 divide-y divide-slate-100">
          {m.recent.map((x, i) => (
            <li key={`${x.test.id}-${x.question}-${i}`} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">{x.test.title}</span>
                <span>Q{x.question}</span>
                <span>{dayLabel(x.test.date)}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5">{x.subject} · {x.topic}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5">{DIFFICULTY_LABELS[x.difficulty] ?? x.difficulty} · {TYPE_LABELS[x.type] ?? x.type}</span>
                <span className={`rounded px-1.5 py-0.5 font-bold ${x.outcome === 'PARTIAL' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{x.outcome === 'PARTIAL' ? 'Partly correct' : 'Incorrect'}</span>
              </div>
              <p className="mt-1.5 text-sm whitespace-pre-line text-slate-800">{x.text}</p>
              <p className="mt-1 text-xs text-slate-500">
                {x.response !== null && <>Answered <span className="font-semibold text-slate-700">{x.response}</span> · </>}
                {x.correctAnswer !== null && <>Correct <span className="font-semibold text-emerald-700">{x.correctAnswer}</span> · </>}
                {num(x.marksAwarded)} / {x.marks} marks
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

const Legend = ({ tone, label }: { tone: string; label: string }) => <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${tone}`} />{label}</span>

/** 5. Teacher Feedback: daily ratings, attendance and PTM history. */
export function FeedbackSection({ r }: { r: StudentReport }) {
  const f = r.feedback
  const dims = [
    ['Attitude', f.ratings?.attitude],
    ['Behaviour', f.ratings?.behaviour],
    ['Focus', f.ratings?.focus],
    ['Interaction', f.ratings?.interaction],
  ] as const
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Daily ratings" sub={f.ratings ? `${f.ratings.days} day${f.ratings.days === 1 ? '' : 's'} evaluated · ${f.ratings.count} rating${f.ratings.count === 1 ? '' : 's'}` : 'From Student Ratings (faculty)'}>
          {!f.ratings ? (
            <Empty icon={Star} title="Not rated this year" sub="Teachers rate students from the Student Ratings page." />
          ) : (
            <div className="space-y-3.5">
              {dims.map(([label, v]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-slate-800">{label}</span><span className="text-xs font-bold text-slate-700 tabular-nums">{v ?? '—'} / 5</span></div>
                  <Meter value={v === null || v === undefined ? null : (v / 5) * 100} tone="bg-violet-500" />
                </div>
              ))}
              <p className="border-t border-slate-100 pt-3 text-sm text-slate-600">Behaviour score <span className="font-bold text-slate-900">{f.ratings.score ?? '—'} / 5</span> <span className="text-xs text-slate-400">(mean of the four)</span></p>
            </div>
          )}
        </Card>
        <Card title="Attendance" sub="Present or late, out of classes that count (excused don't)">
          {f.attendance.classes === 0 ? (
            <Empty icon={CalendarCheck} title="No attendance marked this year" />
          ) : (
            <div className="space-y-3">
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{pct(f.attendance.rate)}</p>
              <Meter value={f.attendance.rate} tone={toneOf(f.attendance.rate)} />
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {([['Present', f.attendance.present], ['Late', f.attendance.late], ['Absent', f.attendance.absent], ['Excused', f.attendance.excused]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-50 py-2"><p className="text-base font-bold text-slate-900 tabular-nums">{v}</p><p className="text-slate-500">{k}</p></div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
      {f.recentRatings.some((x) => x.notes) && (
        <Card title={f.ownOnly ? 'Your notes' : "Teachers' notes"} sub={f.ownOnly ? 'From your recent daily ratings' : 'From recent daily ratings'}>
          <ul className="-my-2 divide-y divide-slate-100">
            {f.recentRatings.filter((x) => x.notes).map((x, i) => (
              <li key={`${x.date}-${x.raterName}-${i}`} className="py-2.5 text-sm">
                <p className="text-[11px] text-slate-500">{dayLabel(x.date)} · {x.raterName}</p>
                <p className="mt-0.5 text-slate-800">{x.notes}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title="PTM history"
        sub={
          f.ptm.meetings
            ? `${f.ptm.meetings} meeting${f.ptm.meetings === 1 ? '' : 's'} by all teachers · parent attendance ${pct(f.ptm.parentAttendanceRate)}${f.ownOnly ? ' · notes below are the ones you logged' : ''}`
            : 'From PTM Notes (faculty)'
        }
      >
        {f.ptm.notes.length === 0 ? (
          <Empty icon={Users} title={f.ownOnly && f.ptm.meetings ? 'You haven’t logged a meeting with this student’s parents this year' : 'No parent meetings logged this year'} />
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {f.ptm.notes.map((n, i) => (
              <li key={`${n.date}-${i}`} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700">{dayLabel(n.date)}</span>
                  <span>{n.teacherName}</span>
                  {n.teacherLeft && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">Teacher has left</span>}
                  {n.parentName && <span>with {n.parentName}</span>}
                  <span className={`rounded px-1.5 py-0.5 font-bold ${n.parentAttended ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{n.parentAttended ? 'Parent attended' : 'Parent absent'}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-slate-800"><MessageSquareText className="mr-1 inline size-3.5 text-slate-400" />{n.discussion}</p>
                {n.actionItems && <p className="mt-1 text-xs whitespace-pre-line text-slate-600"><ClipboardList className="mr-1 inline size-3.5 text-slate-400" />{n.actionItems}</p>}
                {n.followUpDate && <p className="mt-1 text-[11px] text-slate-500">Follow-up {dayLabel(n.followUpDate)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">{label}</p>
      <p className="mt-1.5 truncate text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

/** "12 topics", or "Showing 25 of 40 topics" when the band was capped. */
function bandCount(shown: number, total = shown) {
  if (total > shown) return `Showing ${shown} of ${total} topics`
  return `${total} topic${total === 1 ? '' : 's'}`
}
