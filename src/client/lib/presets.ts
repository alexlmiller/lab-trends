// Starter compare sets. Only markers that have results are used.
export const PRESETS: { name: string; slugs: string[] }[] = [
  { name: 'Inflammation', slugs: ['crp', 'esr', 'wbc', 'ferritin', 'platelets'] },
  { name: 'Iron', slugs: ['ferritin', 'iron-serum', 'transferrin-saturation', 'tibc', 'hemoglobin'] },
  { name: 'Red cells', slugs: ['hemoglobin', 'hematocrit', 'rbc', 'mcv', 'rdw'] },
  { name: 'White cells', slugs: ['wbc', 'neutrophils-absolute', 'lymphocytes-absolute', 'monocytes-absolute', 'eosinophils-absolute'] },
  { name: 'Hormones', slugs: ['estradiol', 'fsh', 'testosterone-total', 'testosterone-free', 'dhea-s'] },
  { name: 'Thyroid', slugs: ['tsh', 'free-t4', 't3-total'] },
  { name: 'Lipids', slugs: ['cholesterol-total', 'ldl', 'hdl', 'triglycerides', 'non-hdl-cholesterol'] },
  { name: 'Glucose', slugs: ['glucose', 'hba1c', 'insulin', 'homa-ir'] },
  { name: 'Kidney & liver', slugs: ['creatinine', 'egfr', 'bun', 'alt', 'ast', 'alkaline-phosphatase'] },
]
