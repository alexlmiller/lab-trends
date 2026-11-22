# Getting lab history out of patient portals

Research notes as of 2026-11-19, not a user guide. **[unverified]** marks claims backed only by third-party sources or inference. Re-check sources before turning this into user-facing docs.

## Summary

- Epic: request MyChart's computer-readable (Cures Act EHI) export. It is the most complete and exact source and needs no app registration; it takes days.
- First import feature to build: FHIR R4 lab upload. It covers MyFlexpa downloads and Apple Health exports now, and a direct "connect MyChart" flow later.
- Direct Epic connection (SMART on FHIR) is free and auto-distributed, but means OAuth/JWKS work and Epic developer approval.
- Aggregator APIs and TEFCA IAS are not viable for a small self-hosted app: Flexpa's platform starts at $20k/yr; IAS needs a QHIN contract and identity proofing.

## Patient-side options for Epic history (by effort)

1. **Sharing Hub snapshot** (~10 min). Menu → Sharing Hub → Yourself → Download or send a snapshot → All Visits (or Date Range) → Download all.
   - Output: zip with `My Health Summary.PDF`, `INDEX.HTM`, `IHE_XDM/…/DOC*.XML` (C-CDA) and `METADATA.XML` ([Duke](https://dukemychart-poc.duhs.duke.edu/home/en-US/docs/DownloadingDocumentsInMyChart.pdf)).
   - Steps: [Portland Clinic, 2025](https://www.theportlandclinic.com/wp-content/uploads/2025/05/TPC-Original-MyChart_How-to-Download-Medical-History_May2025.pdf); same Sharing Hub in a 2026 [Wellstar tip sheet](https://mychart.wellstar.org/mychart/en-us/docs/tipsheets/MyChart_Request%20Records.pdf).
   - **[unverified]** whether every lab is included. One converter says portal Test Results "are not part of the C-CDA export" ([mychartMarkdown](https://github.com/ericpullen/mychartMarkdown)). Open one zip and check the Results sections.
   - The PDF works with the current import pipeline.
2. **Per-test trend PDF.** Test Results → a result → Compare result trends → Download ([MyChart help](https://www.mychart.org/l/en-us/help/download-results/)). One PDF per analyte for its whole history instead of one per draw. **[unverified]** whether ranges and flags appear for every point.
3. **Computer-readable (EHI) export.** Epic: "Request your health record in a computer-readable format"; takes a few days; arrives as a folder of files ([mychart.org](https://www.mychart.org/HappyTogether)).
   - Label and route vary by organization: Sharing Hub "Request Computer-readable Export" with a 30-day maximum at [Samaritan](https://samhealth.org/patient-visitors/request-medical-records/request-computer-readable-files/); a medical-records office request at [Cleveland Clinic](https://my.clevelandclinic.org/patients/information/medical-records).
   - Fallback: written HIPAA right-of-access request citing 45 CFR 170.315(b)(10) ([HealthIT.gov](https://www.healthit.gov/test-method/electronic-health-information-export); templates in [request-my-ehi](https://skills.cat/skills/jmandel/request-my-ehi)).
   - Format: Epic-native TSV ([EHI Tables](https://open.epic.com/EHITables)). Labs are in [`ORDER_RESULTS`](https://open.epic.com/EHITables/GetTable/ORDER_RESULTS.htm):
     - value: `ORD_VALUE` (string), `ORD_NUM_VALUE` (`9999999` = non-numeric)
     - units and range: `REFERENCE_UNIT`, `REFERENCE_LOW`/`REFERENCE_HIGH`, `REF_NORMAL_VALS`
     - flag and status: `RESULT_FLAG_C_NAME`, `RESULT_STATUS_C_NAME`
     - test: `COMPONENT_ID`/`COMPONENT_ID_NAME`, LOINC long name, `COMPON_LNC_SRC_C_NAME` (reported vs inferred LOINC)
     - time: `COMP_OBS_INST_TM` (collection), analysis time
     - Join `ORDER_PROC` for the order. Contents "may vary" by Epic version and configuration.
4. **MyFlexpa** (free, third party). Connects to Epic and other sources; downloads FHIR `$everything`, `$summary`, a PDF, or a zip with one bundle per source; does not keep data between sessions ([docs](https://www.flexpa.com/docs/myflexpa)). Since July 2026 its PDF lays labs out as a date × test grid with range flags ([changelog](https://www.flexpa.com/docs/changelog)). Records pass through a third party; some providers ask for ID photo plus selfie ([steps](https://www.flexpa.com/docs/guides/patient/steps-to-connect)). Not tested.
5. **Apple Health** (iPhone, only where the organization enabled Health Records; [Apple](https://support.apple.com/guide/healthregister/apde63dd3f84/web)). Health → profile → Export All Health Data; the zip has `clinical-records/*.json` (FHIR) and `ClinicalRecord` entries in `export.xml` with `resourceFilePath`/`fhirVersion` ([parser](https://pkg.go.dev/github.com/lsmoura/health/pkg/health)). Format is undocumented by Apple **[third-party evidence only]**. Files may be DSTU2.
6. **Release-of-information request.** Usually PDF, up to 30 days.

MyChart "Link My Accounts" can show results from other Epic organizations ([Kaiser](https://healthy.kaiserpermanente.org/southern-california/support/help-with-mychart)); whether they appear in that portal's exports is **[unverified]**.

## Import features worth building

| # | Feature | Effort | Yields | Blockers |
|---|---|---|---|---|
| 1 | FHIR R4 lab upload (Bundle, NDJSON, zip, Apple `clinical-records`) → review UI | 1–3 days | LOINC + local code, value/comparator, unit, range, interpretation, times, status | None. Covers MyFlexpa, Apple, Fasten bundles, and #4. Check `fhirVersion` for Apple. |
| 2 | Epic EHI TSV (`ORDER_RESULTS` ⋈ `ORDER_PROC`) | 1–2 days | Most complete Epic history, exact strings, flags, LOINC source | Per-org request and wait; contents vary; large zips; Epic only |
| 3 | C-CDA Results (MyChart zip, Oracle Health, VA) | 2–4 days deterministic; ~0.5 day via the existing AI extractor | Values, units, ranges, interpretation; LOINC is only SHOULD | One document per visit → de-duplication |
| 4 | "Connect MyChart" (SMART standalone launch) | 3–7 days + upkeep | Live incremental sync from auto-download Epic orgs | Epic approval, key hosting, token security |
| 5 | Oracle Health (Cerner) consumer connect | +1–2 days after #4 | Same for Millennium sites | Free registration at code-console.cerner.com; auto-provisioned to consumer endpoints ([Oracle](https://docs.oracle.com/en/industries/health/millennium-platform-apis/mfacc/index.html)) |

### Epic patient-facing app requirements

From Epic's [Patient-Facing Apps doc](https://fhir.epic.com/Documentation?docId=patientfacingfhirapps) unless noted.

- Free. Sign-up asks for company name, email and business address ([fhir.epic.com/Developer](https://fhir.epic.com/Developer)). Whether an individual is approved is **[unverified]**.
- Auto-download needs: USCDI v3 APIs only (Epic Aug 2024+), read-only, patient-facing; "Enable Auto-download" and "USCDI v3" selected; "Ready for Production"; no refresh tokens, or refresh tokens with a client credential uploaded per organization; the organization hasn't disabled auto-download. Epic says all US provider organizations currently receive qualifying client IDs. Sync runs on a rolling 12-hour cycle.
- Data Use Questionnaire required; it drives the patient consent screen.
- Refresh tokens need the confidential-client profile; a JWK Set URL (servable from the Worker) is recommended. The app reaches an organization only after a key is provisioned there ("Review & Manage Downloads"). The patient picks the access duration in MyChart.
- Per-organization activation for non-production and production ([Medblocks](https://medblocks.com/docs/patient-access/epic), third party).
- Endpoints: User-access Brands Bundle (R4) on [open.epic Endpoints](https://open.epic.com/MyApps/Endpoints); refresh weekly and self-host.
- Lab APIs: Observation.Search (Labs) R4, DiagnosticReport.Search/Read (Results) R4, Binary.Read (Labs).

## Sources at a glance

| Source | Patient bulk export | Patient-access API | Notes |
|---|---|---|---|
| Epic MyChart | Snapshot zip (PDF + C-CDA); trend PDF; EHI TSV | SMART on FHIR R4, USCDI v3, free, auto-distributed; TEFCA IAS (>200 Epic orgs, Sept 2025) | HTI-5 final rule (Oct 2026) reportedly kept (b)(10)/(g)(10) and deferred information-blocking changes ([McGuireWoods](https://www.mcguirewoods.com/client-resources/alerts/2026/10/hhs-finalizes-hti-5-narrowing-health-it-certification-and-deferring-information-blocking-changes/)) **[verify against rule text]** |
| Quest (MyQuest) | One PDF per result; no bulk or date-range export; some history missing | None public; Quanum FHIR is provider-side ([PDF](https://www.questdiagnostics.com/content/dam/corporate/restricted/documents/qps_qecs/Quanum_EHR_FHIR_API.pdf)) | Apple Health integration ([Quest](https://www.questdiagnostics.com/patients/test-results)); duplicate-result reports in Apple Health (2025). HIPAA access applies to labs ([HHS](https://www.hhs.gov/hipaa/for-professionals/faq/2068/if-an-individual-requests-access-from-a-clinical/index.html)). |
| Labcorp | Per-visit PDF; trends back ~15 years ([MyLabcorp](https://www.labcorp.com/content/labcorp/us/en/patients/mylabcorp.html)); HIPAA request ~30 days, cost-based fee ([notice](https://www.labcorp.com/hipaa-privacy/hipaa-notice-privacy-practices)) | None public **[unverified]** | Apple Health link ([support](https://support.ondemand.labcorp.com/hc/en-us/articles/15002449689107-I-want-my-test-results-to-appear-in-my-Apple-Health-account-What-do-I-need-to-do)) |
| Oracle Health / Cerner | Portal C-CDA download ([docs](https://docs.oracle.com/en/industries/health/health-patient-portal/hppug/download-or-share-health-record.html)) | Auto-provisioned consumer apps, free | |
| athenahealth | Portal-dependent **[not researched]** | FHIR for all athenaOne customers; register at the [dev portal](https://docs.mydata.athenahealth.com/fhir-r4/security.html) | "Certified APIs only" may skip review ([Medblocks](https://medblocks.com/docs/patient-access/athena)) **[unverified]** |
| Kaiser | Epic MyChart Sharing Hub ([KP](https://healthy.kaiserpermanente.org/support/health-record-access-update)) | Third-party apps allowed | Presumably in the Epic brands bundle **[unverified]** |
| VA | [Blue Button](https://www.va.gov/bluebutton/) download of labs, notes, summaries | Lighthouse Patient Health API, VA approval for production | Also in Apple Health |
| Apple Health Records | Export → `clinical-records/*.json` | HealthKit needs a native iOS app ([Apple](https://developer.apple.com/documentation/healthkit/accessing-health-records)) | Bridge for Quest/Labcorp → FHIR |
| Android Health Connect | — | Medical Records API experimental, Android 16 ([Google](https://developer.android.com/health-and-fitness/health-connect/medical-records)) | Not a provider connector |
| Fasten OnPrem | FHIR bundle upload only | Doesn't connect to EHRs | Repo archived Jul 2026 ([GitHub](https://github.com/fastenhealth/fasten-onprem)) |
| Flexpa | MyFlexpa (free) | Platform from $20k/yr ([pricing](https://flexpa.com/pricing)) | TEFCA IAS live since Mar 2026 |
| Health Gorilla | — | Contract-based, IAL2 identity proofing ([docs](https://healthgorilla.com/home/policies/product-documentation)) | In litigation with Epic (Jan 2026) |
| 1upHealth, Particle, Metriport, b.well | — | Enterprise, sales-led | Not usable by an individual or small app |
| TEFCA IAS | Use a consumer IAS app | Needs a QHIN contract and approved CSP ([RCE](https://rce.sequoiaproject.org/csp-approval-organizations/), [Epic](https://open.epic.com/Home/Interoperate/TEFCA/IAS)) | Live IAS apps listed on the [RCE map](https://rce.sequoiaproject.org/tefca-map-search/) |

## Data quality by format

- **EHI TSV:** closest to source. Stored string plus numeric form, units, low/high or free-text range, flag, status, collection and analysis times, LOINC with reported/inferred source.
- **FHIR (US Core lab):** LOINC SHALL be used when the concept exists; units are UCUM when coded; date at least to the day. `referenceRange` and `interpretation` aren't Must Support in [US Core 6.1](https://hl7.org/fhir/us/core/STU6.1/StructureDefinition-us-core-observation-lab.html), so expect gaps. Historical or scanned results may lack LOINC; keep the local code and display text. Watch `"<0.5"` as `valueString` vs a comparator.
- **C-CDA:** non-UCUM units in `originalText`/translation ([HL7](https://cdasearch.hl7.org/examples/view/Results/Results%20Unit%20Non-UCUM)); range and interpretation optional ([ResultObservation](https://hl7.org/cda/us/ccda/3.0.0/StructureDefinition-ResultObservation.html)); C-CDA→FHIR keeps only the "N" range ([mapping](https://build.fhir.org/ig/HL7/ccda-on-fhir/CF-results.html)).
- **PDF:** exactly what was printed, including comments; no codes; needs AI extraction and review.
- **All structured formats:** only what the organization stores discretely. History migrated in as scanned documents won't appear as results.
