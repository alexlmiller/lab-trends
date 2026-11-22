/** −1…+1 bar with the 95% interval as a whisker. */
export function CorrBar({ r, lo, hi }: { r: number; lo: number; hi: number }) {
  const x = (v: number) => 50 + v * 50
  return (
    <svg width={100} height={14} className="hidden shrink-0 sm:block" aria-hidden>
      <rect x={0} y={6} width={100} height={2} fill="var(--color-line)" />
      <line x1={50} x2={50} y1={2} y2={12} stroke="var(--color-line-strong)" />
      <line x1={x(lo)} x2={x(hi)} y1={7} y2={7} stroke={r > 0 ? 'var(--color-pos)' : 'var(--color-neg)'} strokeWidth={2} opacity={0.4} />
      <circle cx={x(r)} cy={7} r={4} fill={r > 0 ? 'var(--color-pos)' : 'var(--color-neg)'} />
    </svg>
  )
}
