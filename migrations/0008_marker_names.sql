-- Consistent names for the built-in tests. Short names: the name people recognise, at most
-- 20 characters, sentence case, qualifiers in plain words ("Total cholesterol", "Neutrophil
-- count"). Long names: the full name in sentence case.
--
-- Each update applies only while the name is still the one 0002 seeded, so a test someone
-- renamed keeps their name. Names are also used to match imported rows, so the old names are
-- added as aliases first.


UPDATE lab_markers SET name = 'Basophil count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_basophils_absolute' AND name = 'Basophils Abs';
UPDATE lab_markers SET name = 'Eosinophil count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_eosinophils_absolute' AND name = 'Eosinophils Abs';
UPDATE lab_markers SET name = 'Immature gran count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_immature_granulocytes_absolute' AND name = 'Immature Gran Abs';
UPDATE lab_markers SET long_name = 'Absolute immature granulocyte count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_immature_granulocytes_absolute' AND long_name = 'Absolute immature granulocytes';
UPDATE lab_markers SET name = 'Lymphocyte count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_lymphocytes_absolute' AND name = 'Lymphocytes Abs';
UPDATE lab_markers SET name = 'Lymphocyte %', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_lymphocytes_percent' AND name = 'Lymphocytes %';
UPDATE lab_markers SET long_name = 'Lymphocyte percentage', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_lymphocytes_percent' AND long_name = 'Lymphocytes percent';
UPDATE lab_markers SET name = 'Monocyte count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_monocytes_absolute' AND name = 'Monocytes Abs';
UPDATE lab_markers SET name = 'Neutrophil count', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_neutrophils_absolute' AND name = 'Neutrophils Abs';
UPDATE lab_markers SET name = 'Neutrophil %', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_neutrophils_percent' AND name = 'Neutrophils %';
UPDATE lab_markers SET long_name = 'Neutrophil percentage', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_neutrophils_percent' AND long_name = 'Neutrophils percent';
UPDATE lab_markers SET name = 'Morning cortisol', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_cortisol_am' AND name = 'Cortisol AM';
UPDATE lab_markers SET long_name = 'Follicle-stimulating hormone', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_fsh' AND long_name = 'Follicle stimulating hormone';
UPDATE lab_markers SET name = 'Total T3', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_t3_total' AND name = 'T3 Total';
UPDATE lab_markers SET long_name = 'Total triiodothyronine', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_t3_total' AND long_name = 'Total T3';
UPDATE lab_markers SET long_name = 'Thyroid-stimulating hormone', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_tsh' AND long_name = 'Thyroid stimulating hormone';
UPDATE lab_markers SET name = 'Free testosterone', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_testosterone_free' AND name = 'Testosterone Free';
UPDATE lab_markers SET name = 'Total testosterone', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_testosterone_total' AND name = 'Testosterone Total';
UPDATE lab_markers SET name = 'IgA', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_iga_total_serum' AND name = 'IgA Total Serum';
UPDATE lab_markers SET long_name = 'Immunoglobulin A', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_iga_total_serum' AND long_name = 'Total serum IgA';
UPDATE lab_markers SET name = 'IgG', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_igg_total_serum' AND name = 'IgG Total Serum';
UPDATE lab_markers SET long_name = 'Immunoglobulin G', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_igg_total_serum' AND long_name = 'Total serum IgG';
UPDATE lab_markers SET name = 'IgM', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_igm_total_serum' AND name = 'IgM Total Serum';
UPDATE lab_markers SET long_name = 'Immunoglobulin M', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_igm_total_serum' AND long_name = 'Total serum IgM';
UPDATE lab_markers SET name = 'ESR', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_esr' AND name = 'Sed Rate';
UPDATE lab_markers SET long_name = 'Total iron-binding capacity', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_tibc' AND long_name = 'Total iron binding capacity';
UPDATE lab_markers SET name = 'Iron saturation', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_transferrin_saturation' AND name = 'Transferrin Sat';
UPDATE lab_markers SET name = 'Chol/HDL ratio', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_cholesterol_hdl_ratio' AND name = 'Chol/HDLC Ratio';
UPDATE lab_markers SET name = 'Total cholesterol', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_cholesterol_total' AND name = 'Cholesterol Total';
UPDATE lab_markers SET name = 'Non-HDL', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_non_hdl_cholesterol' AND name = 'Non-HDL Cholesterol';
UPDATE lab_markers SET name = 'VLDL', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_vldl_cholesterol' AND name = 'VLDL Cholesterol';
UPDATE lab_markers SET name = 'A/G ratio', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_albumin_globulin_ratio' AND name = 'A/G Ratio';
UPDATE lab_markers SET name = 'ALP', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_alkaline_phosphatase' AND name = 'Alkaline Phosphatase';
UPDATE lab_markers SET name = 'Total bilirubin', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_bilirubin_total' AND name = 'Bilirubin Total';
UPDATE lab_markers SET name = 'CO2', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_carbon_dioxide' AND name = 'Carbon Dioxide';
UPDATE lab_markers SET long_name = 'Carbon dioxide (bicarbonate)', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_carbon_dioxide' AND long_name = 'Carbon dioxide';
UPDATE lab_markers SET name = 'Total protein', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_protein_total' AND name = 'Protein Total';
UPDATE lab_markers SET name = 'Folate', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_folic_acid' AND name = 'Folic Acid';
UPDATE lab_markers SET long_name = 'Folate (folic acid)', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_folic_acid' AND long_name = 'Folic acid';
UPDATE lab_markers SET name = 'Vitamin D', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_vitamin_d_25_oh' AND name = 'Vitamin D 25-OH';
UPDATE lab_markers SET long_name = '25-hydroxyvitamin D', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_vitamin_d_25_oh' AND long_name = '25-hydroxy vitamin D';
UPDATE lab_markers SET default_units = 'ug/dL', updated_at = '2026-11-22T00:00:00Z' WHERE id = 'mk_tibc' AND default_units = 'mcg/dL';
