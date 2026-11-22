import type { Panel } from '../../shared/types'

export function drawHistoryPath(markerId: string, panel: Pick<Panel, 'id' | 'draw_date'>) {
  return '/history?' + new URLSearchParams({ m: markerId, panel: panel.id, inspect: panel.draw_date })
}

/** A draw on the results page, optionally with one result opened. */
export function drawPath(panelId: string, resultId?: string) {
  return '/?' + new URLSearchParams({ draw: panelId, ...(resultId ? { result: resultId } : {}) })
}
