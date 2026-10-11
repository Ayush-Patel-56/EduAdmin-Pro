import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Award, Briefcase, Columns3, Plus, RefreshCw, Shield, Users, type LucideIcon } from 'lucide-react'
import { useIsFetching } from '@tanstack/react-query'
import { ErrorBanner } from '@/components/ui/form'
import { useAdminContext } from '../adminContext'
import { RECRUITMENT, useOverview, useRefreshRecruitment, type Appraisal, type Candidate, type Interview, type Requirement } from './api'
import { AppraisalsTab } from './AppraisalsTab'
import { AuditTab } from './AuditTab'
import { CandidatesTab } from './CandidatesTab'
import { AppraisalDialog, CandidateDialog, InterviewDialog, RequirementDialog } from './dialogs'
import { OverviewTab } from './OverviewTab'
import { RequirementsTab } from './RequirementsTab'

type Tab = 'overview' | 'requirements' | 'candidates' | 'appraisals' | 'audit'

export type Modal =
  | { kind: 'requirement'; item?: Requirement }
  | { kind: 'candidate'; item?: Candidate }
  | { kind: 'interview'; item?: Interview; candidateId?: string }
  | { kind: 'appraisal'; item?: Appraisal }
  | null

export function RecruitmentPage() {
  const { schoolId } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const tab = (['overview', 'requirements', 'candidates', 'appraisals', 'audit'] as Tab[]).find((t) => t === params.get('tab')) ?? 'overview'
  const view = params.get('view') === 'interviews' ? 'interviews' : 'profiles'
  const [boardSchool, setBoardSchool] = useState('')
  const overview = useOverview(boardSchool)
  const refresh = useRefreshRecruitment()
  const fetching = useIsFetching({ queryKey: [RECRUITMENT] }) > 0
  const [modal, setModal] = useState<Modal>(null)
  const counts = overview.data?.counts

  const go = (next: { tab?: Tab; view?: string }) =>
    setParams({ tab: next.tab ?? tab, ...(next.view && { view: next.view }) }, { replace: true })

  const cta: { label: string; open: () => void } =
    tab === 'requirements'
      ? { label: 'Add Requirement', open: () => setModal({ kind: 'requirement' }) }
      : tab === 'appraisals'
        ? { label: 'New Appraisal', open: () => setModal({ kind: 'appraisal' }) }
        : { label: 'Add Candidate', open: () => setModal({ kind: 'candidate' }) }

  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Recruitment &amp; Staff Appraisals</h1>
          <p className="mt-1 text-sm text-slate-500">End-to-end faculty lifecycle management, interview evaluation, and performance reviews</p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => refresh()}
            aria-label="Refresh"
            title="Refresh"
            className="flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <RefreshCw className={`size-4 ${fetching ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={cta.open}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
          >
            <Plus className="size-4" /> {cta.label}
          </button>
        </div>
      </section>

      <nav aria-label="Recruitment sections" className="mt-6 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <TabButton icon={Columns3} label="Overview & Pipeline" active={tab === 'overview'} onClick={() => go({ tab: 'overview' })} />
        <TabButton icon={Briefcase} label="Job Requirements" count={counts?.requirements} active={tab === 'requirements'} onClick={() => go({ tab: 'requirements' })} />
        <TabButton icon={Users} label="Candidates & Interviews" count={counts?.candidates} active={tab === 'candidates'} onClick={() => go({ tab: 'candidates', view })} />
        <TabButton icon={Award} label="Teacher Appraisals" count={counts?.appraisals} active={tab === 'appraisals'} onClick={() => go({ tab: 'appraisals' })} />
        <TabButton icon={Shield} label="Audit Logs" count={counts?.auditEvents} active={tab === 'audit'} onClick={() => go({ tab: 'audit' })} />
      </nav>

      <div className="mt-6">
        {tab === 'overview' && <ErrorBanner message={overview.error?.message} />}
        {tab === 'overview' && (
          <OverviewTab
            overview={overview.data}
            loading={overview.isPending}
            boardSchool={boardSchool}
            onBoardSchoolChange={setBoardSchool}
            onViewAll={() => go({ tab: 'candidates', view: 'profiles' })}
          />
        )}
        {tab === 'requirements' && <RequirementsTab onEdit={(item) => setModal({ kind: 'requirement', item })} />}
        {tab === 'candidates' && (
          <CandidatesTab
            view={view}
            onViewChange={(v) => go({ tab: 'candidates', view: v })}
            counts={counts}
            onEditCandidate={(item) => setModal({ kind: 'candidate', item })}
            onSchedule={(candidateId) => setModal({ kind: 'interview', candidateId })}
            onEditInterview={(item) => setModal({ kind: 'interview', item })}
          />
        )}
        {tab === 'appraisals' && <AppraisalsTab onEdit={(item) => setModal({ kind: 'appraisal', item })} />}
        {tab === 'audit' && <AuditTab />}
      </div>

      {modal?.kind === 'requirement' && <RequirementDialog item={modal.item} defaultSchoolId={schoolId} onClose={() => setModal(null)} />}
      {modal?.kind === 'candidate' && <CandidateDialog item={modal.item} defaultSchoolId={schoolId} onClose={() => setModal(null)} />}
      {modal?.kind === 'interview' && (
        <InterviewDialog item={modal.item} candidateId={modal.candidateId} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'appraisal' && <AppraisalDialog item={modal.item} defaultSchoolId={schoolId} onClose={() => setModal(null)} />}
    </>
  )
}

type TabButtonProps = { icon: LucideIcon; label: ReactNode; count?: number; active: boolean; onClick: () => void }

function TabButton({ icon: Icon, label, count, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition ${
        active ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Icon className="size-4" /> {label}
      {count !== undefined && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
          {count}
        </span>
      )}
    </button>
  )
}
