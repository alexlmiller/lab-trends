// Fictional sample records for local development, the screenshots and a public demo.
// Dates are relative to --today (default: the current UTC date), so the records never
// look stale. Running it again replaces every demo person (subject id starting "demo").
//
//   node scripts/demo-data.mjs [--today YYYY-MM-DD] [--out file.sql]
//
// Morgan: 10 draws over three years with a few stories in them. LDL falls and HDL rises
// after a statin; iron runs down and recovers on a supplement; TSH climbs until
// levothyroxine; HbA1c eases after daily walks; vitamin D recovers on D3; CRP and WBC
// spike with a flu. Sam: a second person with three short draws.
import { writeFileSync } from 'node:fs'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const today = arg('--today') ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('--today must be YYYY-MM-DD')
const day = (daysAgo) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
const stamp = (daysAgo) => `${day(daysAgo)}T12:00:00Z`

// Deterministic noise, so the same --today always gives the same file.
let seed = 20261122
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// marker id: [units, low, high, reference text as printed, decimals]
const TESTS = {
  mk_wbc: ['x10E3/uL', 3.4, 10.8, '3.4-10.8', 1],
  mk_rbc: ['x10E6/uL', 3.77, 5.28, '3.77-5.28', 2],
  mk_hemoglobin: ['g/dL', 12.0, 15.5, '12.0-15.5', 1],
  mk_hematocrit: ['%', 36.0, 46.0, '36.0-46.0', 1],
  mk_mcv: ['fL', 80, 100, '80-100', 0],
  mk_rdw: ['%', 11.7, 15.4, '11.7-15.4', 1],
  mk_platelets: ['x10E3/uL', 150, 400, '150-400', 0],
  mk_neutrophils_absolute: ['x10E3/uL', 1.4, 7.0, '1.4-7.0', 1],
  mk_lymphocytes_absolute: ['x10E3/uL', 0.7, 3.1, '0.7-3.1', 1],
  mk_glucose: ['mg/dL', 70, 99, '70-99', 0],
  mk_bun: ['mg/dL', 6, 24, '6-24', 0],
  mk_creatinine: ['mg/dL', 0.57, 1.0, '0.57-1.00', 2],
  mk_egfr: ['mL/min/1.73', 59, null, '>59', 0],
  mk_sodium: ['mmol/L', 134, 144, '134-144', 0],
  mk_potassium: ['mmol/L', 3.5, 5.2, '3.5-5.2', 1],
  mk_carbon_dioxide: ['mmol/L', 20, 29, '20-29', 0],
  mk_calcium: ['mg/dL', 8.7, 10.2, '8.7-10.2', 1],
  mk_albumin: ['g/dL', 3.9, 4.9, '3.9-4.9', 1],
  mk_alt: ['IU/L', 0, 32, '0-32', 0],
  mk_ast: ['IU/L', 0, 40, '0-40', 0],
  mk_alkaline_phosphatase: ['IU/L', 44, 121, '44-121', 0],
  mk_bilirubin_total: ['mg/dL', 0.0, 1.2, '0.0-1.2', 1],
  mk_cholesterol_total: ['mg/dL', 100, 199, '100-199', 0],
  mk_ldl: ['mg/dL', 0, 99, '0-99', 0],
  mk_hdl: ['mg/dL', 39, null, '>39', 0],
  mk_triglycerides: ['mg/dL', 0, 149, '0-149', 0],
  mk_hba1c: ['%', 4.8, 5.6, '4.8-5.6', 1],
  mk_tsh: ['uIU/mL', 0.45, 4.5, '0.450-4.500', 3],
  mk_free_t4: ['ng/dL', 0.82, 1.77, '0.82-1.77', 2],
  mk_ferritin: ['ng/mL', 15, 150, '15-150', 0],
  mk_transferrin_saturation: ['%', 15, 55, '15-55', 0],
  mk_vitamin_d_25_oh: ['ng/mL', 30, 100, '30.0-100.0', 1],
  mk_crp: ['mg/L', 0, 10, '0-10', 1],
  mk_testosterone_total: ['ng/dL', 264, 916, '264-916', 0],
}

// ── Morgan ───────────────────────────────────────────────────────────────
// Days before today of each draw, oldest first.
const DRAWS = [1080, 960, 840, 730, 610, 490, 380, 270, 150, 21]
const STATIN = 680
const VITAMIN_D = 640
const WALKS = 420
const FLU = [498, 491]
const COLD = [160, 153]
const LEVOTHYROXINE = 330
const IRON = 250

// Values per draw (null = not measured that day).
const TRENDS = {
  mk_ldl: [168, null, 174, 171, 112, 96, 88, 84, 81, 79],
  mk_hdl: [38, null, 36, 37, 44, 48, 51, 53, 55, 56],
  mk_cholesterol_total: [241, null, 248, 244, 186, 170, 163, 160, 158, 156],
  mk_triglycerides: [176, null, 181, 182, 150, 138, 129, 121, 116, 112],
  mk_alt: [24, 22, 26, 25, 41, 33, 28, 26, 25, 24],
  mk_ferritin: [64, null, 51, 47, null, 33, 27, 12, 34, 52],
  mk_transferrin_saturation: [null, null, null, 24, null, 19, 15, 11, 18, 26],
  mk_hemoglobin: [13.4, 13.3, 13.1, 13.0, 12.8, 12.6, 12.3, 11.6, 12.4, 13.1],
  mk_mcv: [90, 89, 89, 88, 87, 86, 84, 81, 83, 86],
  mk_rdw: [13.1, 13.2, 13.0, 13.4, 13.6, 13.9, 14.4, 15.9, 16.1, 15.6],
  mk_platelets: [262, 271, 268, 280, 291, 334, 305, 322, 298, 276],
  mk_tsh: [2.1, null, 2.7, null, 3.6, 4.7, 5.4, 3.3, 2.4, 2.1],
  mk_free_t4: [1.18, null, 1.1, null, 1.02, 0.94, 0.88, 1.12, 1.19, 1.21],
  mk_hba1c: [null, 5.7, null, 5.9, null, 6.0, null, 5.7, null, 5.5],
  mk_glucose: [97, 101, 99, 104, 103, 106, 98, 95, 93, 101],
  mk_vitamin_d_25_oh: [22.4, null, null, 19.1, null, null, 34.2, null, 41.5, 44.0],
  mk_crp: [2.1, null, 1.8, null, 2.4, 38.2, 1.6, null, 7.9, 1.4],
  mk_wbc: [6.4, 6.1, 6.8, 6.5, 6.2, 11.6, 6.0, 5.9, 8.9, 6.3],
  mk_neutrophils_absolute: [3.6, 3.4, 3.9, 3.7, 3.5, 8.4, 3.3, 3.2, 5.9, 3.6],
}
// Stable tests: [base, spread].
const STEADY = {
  mk_rbc: [4.45, 0.12],
  mk_lymphocytes_absolute: [1.9, 0.25],
  mk_bun: [14, 3],
  mk_creatinine: [0.78, 0.05],
  mk_egfr: [96, 5],
  mk_sodium: [139, 2],
  mk_potassium: [4.3, 0.25],
  mk_carbon_dioxide: [24, 2],
  mk_calcium: [9.4, 0.25],
  mk_albumin: [4.4, 0.15],
  mk_ast: [21, 3],
  mk_alkaline_phosphatase: [72, 8],
  mk_bilirubin_total: [0.5, 0.15],
}

const sql = []
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const insert = (table, row) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`)

function result(subject, panel, daysAgo, marker, value) {
  const [units, low, high, ref, decimals] = TESTS[marker]
  const raw = value.toFixed(decimals)
  const n = Number(raw)
  const flag = high !== null && n > high ? 'high' : low !== null && n < low ? 'low' : null
  insert('lab_results', {
    id: `${panel}-${marker.slice(3)}`, panel_id: panel, subject_id: subject, marker_id: marker,
    raw_value: raw, comparator: '=', value_numeric: n, raw_units: units, reference_text: ref,
    ref_low: low, ref_high: high, lab_flag: flag, flag_source: flag ? 'reported' : null,
    created_at: stamp(daysAgo), updated_at: stamp(daysAgo),
  })
}

function event(subject, id, kind, label, start, end, { ongoing = false, note = null, notes = null, markers = [], periods = [] } = {}) {
  insert('timeline_events', {
    id, subject_id: subject, kind, label, start_date: day(start), end_date: end === null ? null : day(end), ongoing: ongoing ? 1 : 0,
    period_note: note, notes, marker_ids: JSON.stringify(markers),
    additional_periods: JSON.stringify(periods.map((p) => ({ start_date: day(p.start), end_date: day(p.end), ongoing: false, ...(p.note ? { note: p.note } : {}) }))),
    created_at: stamp(start), updated_at: stamp(start),
  })
}

// Replace whatever demo records are there.
const DEMO = "subject_id LIKE 'demo%'"
sql.push(
  '-- Generated by scripts/demo-data.mjs: fictional records only.',
  `DELETE FROM result_revisions WHERE result_id IN (SELECT id FROM lab_results WHERE ${DEMO});`,
  // Deleting a draw also removes its links to uploads (panel_files cascades).
  ...['lab_results', 'lab_panels', 'extraction_candidates', 'files', 'import_batches', 'personal_targets', 'timeline_events', 'saved_views', 'preferences'].map((t) => `DELETE FROM ${t} WHERE ${DEMO};`),
  "DELETE FROM lab_marker_aliases WHERE scope LIKE 'demo%';",
  "DELETE FROM subjects WHERE id LIKE 'demo%';",
)

insert('subjects', { id: 'demo', display_name: 'Morgan (sample)', created_at: stamp(1100) })
insert('preferences', { subject_id: 'demo', starred_marker_ids: JSON.stringify(['mk_ldl', 'mk_tsh', 'mk_ferritin', 'mk_hba1c']), updated_at: stamp(1100) })
insert('personal_targets', { id: 'demo-target-ldl', subject_id: 'demo', marker_id: 'mk_ldl', target_low: null, target_high: 100, note: 'Goal agreed at the annual physical', created_at: stamp(700), updated_at: stamp(700) })

const LABS = ['Riverside Clinic Lab', 'Sample Reference Lab']
DRAWS.forEach((daysAgo, i) => {
  const panel = `demo-p${i}`
  const notes = i === 5 ? 'Drawn a few days after the flu.' : i === 8 ? 'Getting over a cold.' : null
  insert('lab_panels', {
    id: panel, subject_id: 'demo', draw_date: day(daysAgo), draw_time: i % 2 ? '08:10' : '07:45', facility: LABS[i % 3 === 0 ? 1 : 0],
    notes, tags: JSON.stringify(['fasting']), created_at: stamp(daysAgo), updated_at: stamp(daysAgo),
  })
  for (const [marker, values] of Object.entries(TRENDS)) if (values[i] !== null) result('demo', panel, daysAgo, marker, values[i])
  // Hematocrit follows hemoglobin.
  result('demo', panel, daysAgo, 'mk_hematocrit', TRENDS.mk_hemoglobin[i] * 3.02 + (rand() - 0.5))
  for (const [marker, [base, spread]] of Object.entries(STEADY)) result('demo', panel, daysAgo, marker, base + (rand() - 0.5) * 2 * spread)
})

event('demo', 'statin', 'medication', 'Rosuvastatin', STATIN, null, { ongoing: true, note: '10 mg daily', notes: 'Started for high LDL.', markers: ['mk_ldl', 'mk_hdl', 'mk_cholesterol_total', 'mk_triglycerides'] })
event('demo', 'vitamin-d', 'medication', 'Vitamin D3', VITAMIN_D, null, { ongoing: true, note: '2,000 IU daily', markers: ['mk_vitamin_d_25_oh'] })
event('demo', 'walks', 'lifestyle', 'Daily walks', WALKS, null, { ongoing: true, note: '30 minutes most days', markers: ['mk_hba1c', 'mk_glucose'] })
event('demo', 'infection', 'illness', 'Respiratory infection', FLU[0], FLU[1], { note: 'Flu', periods: [{ start: COLD[0], end: COLD[1], note: 'Head cold' }] })
event('demo', 'levothyroxine', 'medication', 'Levothyroxine', LEVOTHYROXINE, null, { ongoing: true, note: '50 mcg each morning', notes: 'Started after two high TSH results.', markers: ['mk_tsh', 'mk_free_t4'] })
event('demo', 'iron', 'medication', 'Iron supplement', IRON, null, { ongoing: true, note: 'Ferrous sulfate 325 mg every other day', notes: 'Started after a low ferritin.', markers: ['mk_ferritin', 'mk_transferrin_saturation', 'mk_hemoglobin', 'mk_mcv', 'mk_rdw'] })
event('demo', 'knee', 'procedure', 'Knee arthroscopy', 800, null)

// ── Sam ──────────────────────────────────────────────────────────────────
insert('subjects', { id: 'demo-sam', display_name: 'Sam (sample)', created_at: stamp(720) })
const SAM = {
  mk_cholesterol_total: [212, 205, 198], mk_ldl: [138, 131, 124], mk_hdl: [44, 45, 47], mk_triglycerides: [151, 143, 133],
  mk_glucose: [94, 96, 92], mk_hba1c: [5.4, 5.5, 5.4], mk_alt: [29, 34, 31], mk_creatinine: [0.98, 1.01, 0.96],
  mk_egfr: [92, 89, 93], mk_testosterone_total: [512, 488, 530], mk_tsh: [1.6, 1.9, 1.7],
}
;[700, 365, 30].forEach((daysAgo, i) => {
  const panel = `demo-sam-p${i}`
  insert('lab_panels', { id: panel, subject_id: 'demo-sam', draw_date: day(daysAgo), draw_time: '09:20', facility: LABS[0], tags: '[]', created_at: stamp(daysAgo), updated_at: stamp(daysAgo) })
  for (const [marker, values] of Object.entries(SAM)) result('demo-sam', panel, daysAgo, marker, values[i])
})
event('demo-sam', 'sam-running', 'lifestyle', 'Running club', 400, null, { ongoing: true, note: 'Twice a week' })

const out = arg('--out')
if (out) writeFileSync(out, sql.join('\n') + '\n')
else process.stdout.write(sql.join('\n') + '\n')
