import { Construction } from 'lucide-react'

export function SectionPlaceholder({ title }: { title: string }) {
  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <div className="mt-8 flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
        <Construction className="size-8 text-slate-400" />
        <p className="mt-3 text-sm font-medium text-slate-700">This section is coming soon</p>
        <p className="mt-1 text-xs text-slate-500">It will be built in an upcoming phase.</p>
      </div>
    </>
  )
}
