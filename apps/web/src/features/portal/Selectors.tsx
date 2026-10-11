import { GraduationCap, Users } from 'lucide-react'
import { Select } from '@/components/ui/Select'

export const ALL_PROGRAMS = 'all'
export const ALL_BATCHES = 'all'

type FooterAction = { label: string; onSelect: () => void }

type ProgramSelectProps = {
  programs: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
  /** e.g. "Manage Programs" for admins. */
  footer?: FooterAction[]
}

export function ProgramSelect({ programs, value, onChange, footer }: ProgramSelectProps) {
  return (
    <Select
      size="sm"
      aria-label="Program"
      icon={GraduationCap}
      iconClassName="text-fuchsia-500"
      value={value}
      options={[{ value: ALL_PROGRAMS, label: 'All Programs' }, ...programs.map((p) => ({ value: p.id, label: p.name }))]}
      onChange={onChange}
      footer={footer}
    />
  )
}

/** Batches arrive with the batch management feature; until then only "All Batches" is listed. */
export function BatchSelect({ footer }: { footer?: FooterAction[] }) {
  return (
    <Select
      size="sm"
      aria-label="Batch"
      icon={Users}
      iconClassName="text-emerald-600"
      value={ALL_BATCHES}
      options={[{ value: ALL_BATCHES, label: 'All Batches' }]}
      onChange={() => {}}
      footer={footer}
    />
  )
}
