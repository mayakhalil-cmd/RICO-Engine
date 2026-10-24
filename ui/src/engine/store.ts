import { useCallback, useState, useSyncExternalStore } from 'react'
import { rico, type Snapshot } from './connection'
import type { Ack } from './types'

export function useRico<T>(pick: (s: Snapshot) => T): T {
  return useSyncExternalStore(rico.subscribe, () => pick(rico.get()))
}

// Runs a command and keeps track of whether it is busy and what went wrong,
// so buttons can show both without extra code in every screen.
export function useCommand() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (op: string, args: Record<string, unknown> = {}): Promise<Ack> => {
    setBusy(op)
    setError(null)
    const ack = await rico.send(op, args)
    setBusy(null)
    if (!ack.ok) setError(ack.error ?? 'Something went wrong.')
    return ack
  }, [])
  return { run, busy, error, clearError: () => setError(null) }
}
