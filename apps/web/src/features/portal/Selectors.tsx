import { GraduationCap, Users } from 'lucide-react'
import { Select } from '@/components/ui/Select'

export const ALL_PROGRAMS = 'all'

type ProgramSelectProps = {
  programs: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
}

export function ProgramSelect({ programs, value, onChange }: ProgramSelectProps) {
  return (
    <Select
      size="sm"
      aria-label="Program"
      icon={GraduationCap}
      iconClassName="text-fuchsia-500"
      value={value}
      options={[{ value: ALL_PROGRAMS, label: 'All Programs' }, ...programs.map((p) => ({ value: p.id, label: p.name }))]}
      onChange={onChange}
    />
  )
}

/** Batches arrive with the batch management feature; until then the picker is shown disabled. */
export function BatchSelect() {
  return (
    <Select
      size="sm"
      aria-label="Batch"
      icon={Users}
      iconClassName="text-emerald-600"
      value={null}
      options={[]}
      onChange={() => {}}
      placeholder="No batches yet"
      disabled
    />
  )
}
