import { useCallback, useState } from 'react'

/**
 * State for a control that does something asynchronous: `busy` while the work
 * runs and `error` with its message if it throws. `run` resolves true when the
 * work finished, so a caller can close a dialog only on success.
 */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await work()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, run, setError }
}
