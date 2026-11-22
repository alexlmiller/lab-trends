import { correlation, pairSeries, type Correlation, type Method, type Pair } from '../../shared/stats'
import type { MarkerSeries } from '../../shared/types'
import { pointsOf } from './series'

export type CorrOptions = { method: Method; tol: number; log?: boolean; window?: [number, number] | null }

export function pairsFor(a: MarkerSeries, b: MarkerSeries, opts: CorrOptions): Pair[] {
  const w = opts.window
  const pa = pointsOf(a).filter((p) => !w || (p.day >= w[0] && p.day <= w[1]))
  const pb = pointsOf(b).filter((p) => !w || (p.day >= w[0] && p.day <= w[1]))
  return pairSeries(pa.map((p) => ({ day: p.day, value: p.value })), pb.map((p) => ({ day: p.day, value: p.value })), opts.tol)
}

// Series objects belong to one dataset snapshot and change after an edit or a person switch.
const cache = new WeakMap<MarkerSeries, WeakMap<MarkerSeries, Map<string, Correlation | null>>>()

export function correlationFor(a: MarkerSeries, b: MarkerSeries, opts: CorrOptions): Correlation | null {
  let byPartner = cache.get(a)
  if (!byPartner) {
    byPartner = new WeakMap()
    cache.set(a, byPartner)
  }
  let byOptions = byPartner.get(b)
  if (!byOptions) {
    byOptions = new Map()
    byPartner.set(b, byOptions)
  }
  const key = `${opts.method}|${opts.tol}|${opts.log ? 1 : 0}|${opts.window?.join('-') ?? ''}`
  if (byOptions.has(key)) return byOptions.get(key)!
  const c = correlation(pairsFor(a, b, opts), opts.method, opts.log)
  if (byOptions.size >= 32) byOptions.clear()
  byOptions.set(key, c)
  return c
}

export function topCorrelates(target: MarkerSeries, all: MarkerSeries[], opts: CorrOptions & { minN: number; limit?: number }) {
  return all
    .filter((m) => m.id !== target.id)
    .map((m) => ({ marker: m, c: correlationFor(target, m, opts) }))
    .filter((x): x is { marker: MarkerSeries; c: Correlation } => Boolean(x.c && x.c.n >= opts.minN))
    .sort((a, b) => supported(b.c) - supported(a.c))
    .slice(0, opts.limit ?? 8)
}

/** Conservative strength: the 95% bound nearest zero (0 when the interval spans zero). */
export function supported(c: Correlation): number {
  return c.r >= 0 ? Math.max(0, c.lo) : Math.max(0, -c.hi)
}
