// Rebuild a layout-preserving plain-text rendering (like `pdftotext -layout`)
// from positioned pdf.js text items. Patient-portal PDFs often print each
// value on its own line above a range slider; plain text extraction loses the
// association, a column-aligned rendering keeps it readable for a model.

export type TextItem = { str: string; x: number; y: number; width: number; fontSize: number }

export function layoutPage(items: TextItem[]): string {
  const words = items.filter((i) => i.str.trim())
  if (!words.length) return ''
  const sizes = words.map((w) => w.fontSize || 10).sort((a, b) => a - b)
  const base = sizes[Math.floor(sizes.length / 2)] || 10
  const charW = base * 0.5
  // Group into lines by baseline (PDF y grows upward).
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; items: TextItem[] }[] = []
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l.y - w.y) <= Math.max(2, (w.fontSize || base) * 0.45))
    if (line) line.items.push(w)
    else lines.push({ y: w.y, items: [w] })
  }
  lines.sort((a, b) => b.y - a.y)
  const minX = Math.min(...words.map((w) => w.x))
  const out: string[] = []
  let prevY: number | null = null
  for (const line of lines) {
    if (prevY != null && prevY - line.y > base * 2.2) out.push('')
    prevY = line.y
    let text = ''
    let last: TextItem | null = null
    for (const w of line.items.sort((a, b) => a.x - b.x)) {
      // Drop overprinted duplicates (same text drawn twice at ~the same spot).
      if (last && last.str === w.str && Math.abs(last.x - w.x) < Math.max(charW * 2, last.width)) continue
      last = w
      const col = Math.max(0, Math.round((w.x - minX) / charW))
      if (text.length < col) text += ' '.repeat(col - text.length)
      else if (text && !text.endsWith(' ')) text += ' '
      text += w.str
    }
    out.push(text.replace(/\s+$/, ''))
  }
  return out.join('\n')
}
