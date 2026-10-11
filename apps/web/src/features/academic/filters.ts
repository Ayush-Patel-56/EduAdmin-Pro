import { useCallback, useMemo, useState } from 'react'
import type { Structure } from './api'

export const ALL = 'all'

export type AcademicFilters = {
  programId: string
  batchId: string
  setProgramId: (id: string) => void
  setBatchId: (id: string) => void
  /** Batches the Batch filter offers: all, or only the selected program's. */
  batchOptions: Structure['batches']
}

function readStored(key: string): { programId: string; batchId: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as { programId?: unknown; batchId?: unknown } | null
    return {
      programId: typeof parsed?.programId === 'string' ? parsed.programId : ALL,
      batchId: typeof parsed?.batchId === 'string' ? parsed.batchId : ALL,
    }
  } catch {
    return { programId: ALL, batchId: ALL }
  }
}

function store(key: string, value: { programId: string; batchId: string }) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (private mode etc.): filters just won't persist.
  }
}

/**
 * The sidebar Program → Batch filters. Batches depend on the program: picking
 * a program narrows the batch list and clears a batch from another program.
 * Remembered per school (`storageKey`), and ignored if the saved program or
 * batch no longer exists.
 */
export function useAcademicFilters(structure: Structure | undefined, storageKey: string): AcademicFilters {
  const [saved, setSaved] = useState(() => readStored(storageKey))

  const programs = useMemo(() => structure?.programs ?? [], [structure])
  const batches = useMemo(() => structure?.batches ?? [], [structure])
  const programId = structure && !programs.some((p) => p.id === saved.programId) ? ALL : saved.programId
  const batchOptions = useMemo(
    () => (programId === ALL ? batches : batches.filter((b) => b.programId === programId)),
    [batches, programId],
  )
  const batchId = structure && !batchOptions.some((b) => b.id === saved.batchId) ? ALL : saved.batchId

  const update = useCallback(
    (next: { programId: string; batchId: string }) => {
      setSaved(next)
      store(storageKey, next)
    },
    [storageKey],
  )

  const setProgramId = useCallback(
    (id: string) => {
      const keepBatch = id === ALL || batches.some((b) => b.id === batchId && b.programId === id)
      update({ programId: id, batchId: keepBatch ? batchId : ALL })
    },
    [batches, batchId, update],
  )

  const setBatchId = useCallback(
    (id: string) => {
      // Picking a batch also selects its program, so the two never disagree.
      const batch = batches.find((b) => b.id === id)
      update({ programId: batch ? batch.programId : programId, batchId: id })
    },
    [batches, programId, update],
  )

  return { programId, batchId, setProgramId, setBatchId, batchOptions }
}
