// Unit *notation* equivalence (10³/uL = 10*3/uL = K/uL, mcg = ug, mm/Hr = mm/h).
// Values are never converted.

/** Same unit, any notation or letter case: numbers in these units can be compared directly. */
export function numericUnitKey(units: string | null | undefined): string | null {
  if (!units) return null
  let u = units.trim().toLowerCase()
  if (!u) return null
  u = u
    .replace(/[µμ]/g, 'u')
    .replace(/10³/g, '10*3')
    .replace(/10⁶/g, '10*6')
    .replace(/³/g, '3')
    .replace(/⁶/g, '6')
    .replace(/²/g, '2')
    .replace(/\s+/g, '')
    .replace(/x?10\^|x?10e|x10\*/g, '10*')
    .replace(/^(k|thou|thous)\//, '10*3/')
    .replace(/^(m|mil|mill)\/(?=u?l$|mm3$)/, '10*6/')
    .replace(/mcg/g, 'ug')
    .replace(/\/cumm|\/mm3/g, '/ul')
    .replace(/\/(hr|hrs|hour)$/, '/h')
    .replace(/\*2$/, '2')
  return u
}

/**
 * For the mixed-units warning only: also treats mEq/L as mmol/L, which holds for the
 * monovalent electrolytes labs report but not for divalent ions, so never use it for math.
 */
export function unitKey(units: string | null | undefined): string | null {
  return numericUnitKey(units)?.replace(/meq\/l/g, 'mmol/l') ?? null
}
