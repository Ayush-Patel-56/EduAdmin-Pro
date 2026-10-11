import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, Download, Sheet, Upload } from 'lucide-react'
import { ALL } from '@/features/academic/filters'
import { useAdminContext } from '../adminContext'
import { MASTER_FIELDS, useCurriculumOptions, useMasterSheet, type MasterFilters } from './api'
import { ChaptersTab } from './ChaptersTab'
import { exportMasterSheet } from './exportMaster'
import { ImportCurriculumDialog } from './ImportCurriculumDialog'
import { MasterSheetTab } from './MasterSheetTab'

type Tab = 'chapters' | 'master'

export function CurriculumPage() {
  const { me, schoolId, filters } = useAdminContext()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'master' ? 'master' : 'chapters'
  const { data: options, error: optionsError } = useCurriculumOptions(schoolId)
  // A subject from the URL is only used if it's a real one (links can be edited by hand).
  const requested = params.get('subject')
  const subject = (requested && options?.subjects.includes(requested) ? requested : options?.subjects[0]) ?? ''
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // The master sheet starts on the program picked in the sidebar.
  const [masterFilters, setMasterFilters] = useState<MasterFilters>({
    board: '',
    classLevel: '',
    programId: filters.programId !== ALL ? filters.programId : '',
    subject: '',
  })
  const master = useMasterSheet(schoolId, masterFilters)
  const schoolName = me.memberships.find((m) => m.schoolId === schoolId)?.schoolName ?? 'school'

  function go(next: Record<string, string>) {
    setParams({ ...Object.fromEntries(params), ...next }, { replace: true })
  }

  async function exportExcel() {
    if (!master.data?.length) return
    setExporting(true)
    setExportError(null)
    try {
      await exportMasterSheet(master.data, schoolName)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-[26px]">Curriculum Manager</h1>
          <p className="mt-1 text-sm text-slate-500">Manage chapters and concepts across boards, programs, and class levels.</p>
        </div>
        {tab === 'chapters' ? (
          <button
            type="button"
            onClick={() => setImporting(true)}
            disabled={!options}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink-hover disabled:opacity-50"
          >
            <Upload className="size-4" /> Import CSV
          </button>
        ) : (
          <button
            type="button"
            onClick={exportExcel}
            disabled={!master.data?.length || exporting}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="size-4" /> {exporting ? 'Exporting…' : 'Export to Excel'}
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Curriculum views" className="mt-6 flex gap-2 overflow-x-auto overflow-y-hidden border-b border-slate-200">
        <TabButton active={tab === 'chapters'} onClick={() => go({ tab: 'chapters' })}>
          <BookOpen className="size-4" /> Chapters &amp; Concepts
        </TabButton>
        <TabButton active={tab === 'master'} onClick={() => go({ tab: 'master' })}>
          <Sheet className="size-4" /> Master Sheet
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              tab === 'master' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {MASTER_FIELDS.length} Fields
          </span>
        </TabButton>
      </div>

      <div className="mt-6">
        {optionsError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {optionsError.message}
          </p>
        )}
        {exportError && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            {exportError}
          </p>
        )}
        {options && tab === 'chapters' && (
          <ChaptersTab schoolId={schoolId} options={options} subject={subject} onSubjectChange={(s) => go({ subject: s })} />
        )}
        {options && tab === 'master' && (
          <MasterSheetTab options={options} filters={masterFilters} onFiltersChange={setMasterFilters} query={master} />
        )}
      </div>

      {importing && options && (
        <ImportCurriculumDialog
          schoolId={schoolId}
          options={options}
          defaultSubject={subject}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
        active ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  )
}
