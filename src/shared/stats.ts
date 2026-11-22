// Small, dependency-free statistics for comparing lab series. Everything here
// works on (day, value) points; callers decide which results count as numeric.

export type Pt = { day: number; value: number }
export type Pair = { day: number; dayB: number; a: number; b: number }
export type Method = 'pearson' | 'spearman'

export type Correlation = {
  r: number
  n: number
  lo: number
  hi: number
  /** Correlation of draw-to-draw changes (removes shared long-term trend). */
  deltaR: number | null
  deltaN: number
}

export function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / (values.length || 1)
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1))
}

/**
 * Pair draws of two series. A pair is the closest B draw within `toleranceDays`
 * of an A draw; each draw is used at most once (closest gaps win).
 */
export function pairSeries(a: Pt[], b: Pt[], toleranceDays = 0): Pair[] {
  const candidates: { i: number; j: number; gap: number }[] = []
  let start = 0
  const bs = [...b].sort((x, y) => x.day - y.day)
  const as = [...a].sort((x, y) => x.day - y.day)
  for (let i = 0; i < as.length; i++) {
    while (start < bs.length && bs[start].day < as[i].day - toleranceDays) start++
    for (let j = start; j < bs.length && bs[j].day <= as[i].day + toleranceDays; j++) {
      candidates.push({ i, j, gap: Math.abs(bs[j].day - as[i].day) })
    }
  }
  candidates.sort((x, y) => x.gap - y.gap)
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const pairs: Pair[] = []
  for (const c of candidates) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue
    usedA.add(c.i)
    usedB.add(c.j)
    pairs.push({ day: as[c.i].day, dayB: bs[c.j].day, a: as[c.i].value, b: bs[c.j].value })
  }
  return pairs.sort((x, y) => x.day - y.day)
}

export function pearson(x: number[], y: number[]): number {
  const n = x.length
  if (n < 2) return NaN
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return NaN
  return sxy / Math.sqrt(sxx * syy)
}

/** Average ranks (ties share the mean rank). */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  let k = 0
  while (k < order.length) {
    let end = k
    while (end + 1 < order.length && order[end + 1].v === order[k].v) end++
    const rank = (k + end) / 2 + 1
    for (let t = k; t <= end; t++) out[order[t].i] = rank
    k = end + 1
  }
  return out
}

export function spearman(x: number[], y: number[]): number {
  return pearson(ranks(x), ranks(y))
}

export function correlate(x: number[], y: number[], method: Method): number {
  return method === 'spearman' ? spearman(x, y) : pearson(x, y)
}

/** 95% confidence interval via Fisher z (Fieller's variance for Spearman). */
export function fisherInterval(r: number, n: number, method: Method): [number, number] {
  if (!Number.isFinite(r) || n < 4) return [-1, 1]
  const clamped = Math.max(-0.999999, Math.min(0.999999, r))
  const z = Math.atanh(clamped)
  const se = Math.sqrt((method === 'spearman' ? 1.06 : 1) / (n - 3))
  return [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)]
}

export function correlation(pairs: Pair[], method: Method, log = false): Correlation | null {
  const usable = log ? pairs.filter((p) => p.a > 0 && p.b > 0) : pairs
  const n = usable.length
  if (n < 3) return null
  const x = usable.map((p) => (log ? Math.log(p.a) : p.a))
  const y = usable.map((p) => (log ? Math.log(p.b) : p.b))
  const r = correlate(x, y, method)
  if (!Number.isFinite(r)) return null
  const [lo, hi] = fisherInterval(r, n, method)
  const dx: number[] = []
  const dy: number[] = []
  for (let i = 1; i < n; i++) {
    dx.push(x[i] - x[i - 1])
    dy.push(y[i] - y[i - 1])
  }
  const deltaR = dx.length >= 3 ? correlate(dx, dy, method) : NaN
  return { r, n, lo, hi, deltaR: Number.isFinite(deltaR) ? deltaR : null, deltaN: dx.length }
}

/** Ordinary least squares line. */
export function linearFit(x: number[], y: number[]): { slope: number; intercept: number } | null {
  const n = x.length
  if (n < 2) return null
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx }
}

export function slopePerYear(points: Pt[]): number | null {
  if (points.length < 3) return null
  const fit = linearFit(points.map((p) => p.day / 365.25), points.map((p) => p.value))
  return fit?.slope ?? null
}

export type Strength = 'none' | 'weak' | 'moderate' | 'strong'

export function strengthOf(r: number): Strength {
  const a = Math.abs(r)
  if (a >= 0.7) return 'strong'
  if (a >= 0.4) return 'moderate'
  if (a >= 0.2) return 'weak'
  return 'none'
}

/** The interval excludes zero: the data are at least directionally consistent. */
export function isConsistent(c: Correlation): boolean {
  return c.lo > 0 || c.hi < 0
}
