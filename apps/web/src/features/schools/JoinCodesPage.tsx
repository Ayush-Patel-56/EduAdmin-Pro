import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Check, Copy, RefreshCw, ShieldPlus } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { FormError } from '@/features/auth/AuthInput'

type JoinCode = {
  id: string
  code: string
  role: 'TEACHER' | 'ADMIN'
  uses: number
  maxUses: number | null
  expiresAt: string | null
}

type CodesResponse = {
  school: { id: string; name: string }
  codes: JoinCode[]
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function JoinCodesPage() {
  const { schoolId } = useParams<{ schoolId: string }>()
  const justCreated = (useLocation().state as { justCreated?: boolean } | null)?.justCreated
  const [data, setData] = useState<CodesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<CodesResponse>(`/schools/${schoolId}/join-codes`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to reach the server'))
  }, [schoolId])

  useEffect(load, [load])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server')
    } finally {
      setBusy(false)
    }
  }

  const issue = (role: JoinCode['role']) =>
    run(() => api(`/schools/${schoolId}/join-codes`, { method: 'POST', body: JSON.stringify({ role }) }))
  const revoke = (id: string) =>
    run(() => api(`/schools/${schoolId}/join-codes/${id}/revoke`, { method: 'POST' }))

  const teacherCode = data?.codes.find((c) => c.role === 'TEACHER')
  const adminCodes = data?.codes.filter((c) => c.role === 'ADMIN') ?? []

  return (
    <AuthLayout>
      <div className="w-full max-w-[520px] rounded-3xl bg-white/90 px-8 py-10 shadow-[0_30px_80px_-20px_rgba(79,70,229,0.18)]">
        <Link to="/" className="text-xs text-slate-500 hover:text-slate-800">
          ← Back
        </Link>
        <h1 className="mt-3 text-xl font-bold text-slate-900">{data?.school.name ?? 'Join codes'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {justCreated ? 'Your school is ready. ' : ''}Share these codes so staff can join this school.
        </p>

        <FormError message={error} />
        {!data && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

        {data && (
          <>
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-slate-900">Teacher code</h2>
              <p className="text-xs text-slate-500">
                Reusable. Teachers who join with it wait for your approval.
              </p>
              {teacherCode ? (
                <CodeRow code={teacherCode.code}>
                  <button
                    onClick={() => issue('TEACHER')}
                    disabled={busy}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                    title="Replace with a new code. The old one stops working."
                  >
                    <RefreshCw className="size-3.5" /> Regenerate
                  </button>
                </CodeRow>
              ) : (
                <ActionButton onClick={() => issue('TEACHER')} disabled={busy} label="Generate teacher code" />
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-sm font-semibold text-slate-900">Admin codes</h2>
              <p className="text-xs text-slate-500">
                Single-use, valid for 7 days. Only give these to people who should have full access.
              </p>
              {adminCodes.map((c) => (
                <CodeRow
                  key={c.id}
                  code={c.code}
                  meta={c.expiresAt ? `Expires ${dateFormat.format(new Date(c.expiresAt))}` : undefined}
                >
                  <button
                    onClick={() => revoke(c.id)}
                    disabled={busy}
                    className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </CodeRow>
              ))}
              <ActionButton onClick={() => issue('ADMIN')} disabled={busy} label="Generate admin code" />
            </section>
          </>
        )}
      </div>
    </AuthLayout>
  )
}

function CodeRow({ code, meta, children }: { code: string; meta?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-100 px-4 py-3">
      <div className="flex-1">
        <p className="font-mono text-base font-semibold tracking-wider text-slate-900">{code}</p>
        {meta && <p className="text-[11px] text-slate-500">{meta}</p>}
      </div>
      <button
        onClick={copy}
        aria-label="Copy code"
        className="rounded p-1 text-slate-400 hover:text-slate-700"
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
      {children}
    </div>
  )
}

function ActionButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
    >
      <ShieldPlus className="size-4" /> {label}
    </button>
  )
}
