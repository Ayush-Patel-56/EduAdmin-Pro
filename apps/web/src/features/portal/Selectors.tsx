import { GraduationCap, Users } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { ALL } from '@/features/academic/filters'

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
      options={[{ value: ALL, label: 'All Programs' }, ...programs.map((p) => ({ value: p.id, label: p.name }))]}
      onChange={onChange}
      footer={footer}
    />
  )
}

type BatchSelectProps = {
  /** Already narrowed to the selected program. */
  batches: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
  footer?: FooterAction[]
}

export function BatchSelect({ batches, value, onChange, footer }: BatchSelectProps) {
  return (
    <Select
      size="sm"
      aria-label="Batch"
      icon={Users}
      iconClassName="text-emerald-600"
      value={value}
      options={[{ value: ALL, label: 'All Batches' }, ...batches.map((b) => ({ value: b.id, label: b.name }))]}
      onChange={onChange}
      footer={footer}
    />
  )
}
