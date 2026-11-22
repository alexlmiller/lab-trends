-- Common report spellings the seed catalog did not cover.
INSERT OR IGNORE INTO lab_marker_aliases (id, marker_id, source_name, normalized_name, scope, created_at) VALUES
  ('al_rdw_cv', 'mk_rdw', 'RDW CV', 'rdw cv', 'global', '2026-11-18T00:00:00Z'),
  ('al_rdw_dash_cv', 'mk_rdw', 'RDW-CV', 'rdw cv', 'global', '2026-11-18T00:00:00Z'),
  ('al_plt_count', 'mk_platelets', 'Platelet Count', 'platelet count', 'global', '2026-11-18T00:00:00Z'),
  ('al_wbc_count', 'mk_wbc', 'WBC Count', 'wbc count', 'global', '2026-11-18T00:00:00Z'),
  ('al_rbc_count', 'mk_rbc', 'RBC Count', 'rbc count', 'global', '2026-11-18T00:00:00Z'),
  ('al_hgb', 'mk_hemoglobin', 'Hgb', 'hgb', 'global', '2026-11-18T00:00:00Z'),
  ('al_hct', 'mk_hematocrit', 'Hct', 'hct', 'global', '2026-11-18T00:00:00Z'),
  ('al_crp_hs', 'mk_crp', 'CRP, High Sensitivity', 'crp high sensitivity', 'global', '2026-11-18T00:00:00Z'),
  ('al_sed', 'mk_esr', 'Sed Rate, Westergren', 'sed rate westergren', 'global', '2026-11-18T00:00:00Z');
