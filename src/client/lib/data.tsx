import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import type { Dataset, Marker, MarkerSeries, Me } from '../../shared/types'
import { api, ApiError } from './api'

/** The app is not usable yet: sign-in is off, locked to another Access application, or this person is not on the list. */
export type Gate = { code: 'access_off' | 'access_mismatch' | 'forbidden' | 'unverified' | 'not_ready' | 'misconfigured'; team?: string; email?: string }
const GATE_CODES = ['access_off', 'access_mismatch', 'forbidden', 'unverified', 'not_ready', 'misconfigured']

type DataState = {
  me: Me | null
  gate: Gate | null
  subjectId: string | null
  setSubjectId: (id: string) => void
  dataset: Dataset | null
  markersById: Map<string, MarkerSeries>
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  catalog: Marker[] | null
  loadCatalog: () => Promise<Marker[]>
}

const Ctx = createContext<DataState | null>(null)
const SUBJECT_KEY = 'lab-trends.subject'

function readStoredSubject(): string | null {
  try {
    return localStorage.getItem(SUBJECT_KEY)
  } catch {
    return null
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams()
  const [me, setMe] = useState<Me | null>(null)
  const [subjectId, setSubjectIdState] = useState<string | null>(() => params.get('person') ?? readStoredSubject())
  const [loadedDataset, setDataset] = useState<Dataset | null>(null)
  const dataset = loadedDataset?.subject.id === subjectId ? loadedDataset : null
  const activeSubject = useRef(subjectId)
  const requestNumber = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<Gate | null>(null)
  const [catalog, setCatalog] = useState<Marker[] | null>(null)

  const setSubjectId = useCallback((id: string) => {
    setSubjectIdState(id)
    try {
      localStorage.setItem(SUBJECT_KEY, id)
    } catch {
      /* storage unavailable */
    }
  }, [])

  useEffect(() => {
    api
      .get<Me>('/me')
      .then((m) => {
        setMe(m)
        setSubjectIdState((current) => (current && m.subjects.some((s) => s.id === current) ? current : (m.subjects[0]?.id ?? null)))
        if (!m.subjects.length) setLoading(false)
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.code && GATE_CODES.includes(e.code)) setGate({ code: e.code as Gate['code'], ...e.detail })
        else setError(e.message)
        setLoading(false)
      })
  }, [])

  const reload = useCallback(async () => {
    if (!subjectId || subjectId !== activeSubject.current) return
    const request = ++requestNumber.current
    try {
      const d = await api.get<Dataset>(`/subjects/${subjectId}/dataset`)
      if (request !== requestNumber.current) return
      setDataset(d)
      setError(null)
    } catch (e) {
      if (request === requestNumber.current) setError((e as Error).message)
    } finally {
      if (request === requestNumber.current) setLoading(false)
    }
  }, [subjectId])

  useEffect(() => {
    if (!subjectId) return
    activeSubject.current = subjectId
    setError(null)
    setLoading(true)
    void reload()
    return () => {
      activeSubject.current = null
      requestNumber.current++
    }
  }, [subjectId, reload])

  const loadCatalog = useCallback(async () => {
    const list = await api.get<Marker[]>('/markers')
    setCatalog(list)
    return list
  }, [])

  const markersById = useMemo(() => new Map((dataset?.markers ?? []).map((m) => [m.id, m])), [dataset])

  const value = useMemo(
    () => ({ me, gate, subjectId, setSubjectId, dataset, markersById, loading, error, reload, catalog, loadCatalog }),
    [me, gate, subjectId, setSubjectId, dataset, markersById, loading, error, reload, catalog, loadCatalog],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}

/** Dataset is guaranteed loaded inside pages rendered by the layout. */
export function useDataset(): Dataset & { markersById: Map<string, MarkerSeries>; reload: () => Promise<void>; subjectId: string } {
  const { dataset, markersById, reload, subjectId } = useData()
  if (!dataset || !subjectId) throw new Error('Dataset not loaded')
  return { ...dataset, markersById, reload, subjectId }
}

/** URL search-param state. Meaningful view changes push history entries. */
export function useParam(key: string, fallback: string): [string, (value: string | null, replace?: boolean) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const set = useCallback(
    (next: string | null, replace = false) => {
      // Start from the live URL: the router's params can be a render behind
      // when several controls change in quick succession.
      const p = new URLSearchParams(window.location.search)
      if (next == null || next === '' || next === fallback) p.delete(key)
      else p.set(key, next)
      setParams(p, { replace })
    },
    [key, fallback, setParams],
  )
  return [value, set]
}

export function useListParam(key: string): [string[], (values: string[], replace?: boolean) => void] {
  const [raw, set] = useParam(key, '')
  const list = useMemo(() => raw.split(',').filter(Boolean), [raw])
  return [list, (values, replace) => set(values.join(','), replace)]
}

/**
 * Update several search params in one navigation. Two separate setter calls in
 * the same tick would each start from the same stale URL and the second would
 * drop the first's change.
 */
export function useUpdateParams(): (updates: Record<string, string | null>, replace?: boolean) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (updates, replace = false) => {
      const p = new URLSearchParams(window.location.search)
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === '') p.delete(k)
        else p.set(k, v)
      }
      setParams(p, { replace })
    },
    [setParams],
  )
}
