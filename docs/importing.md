# Importing your lab results

Lab Trends reads PDF reports, photos or screenshots of reports, and CSV or XLSX spreadsheets. Upload them on **Import results**. Each file becomes a draft you review and correct before anything reaches the charts.

- A report with many dates becomes one draw per collection date.
- Values already saved are skipped, and a value that differs from a saved one keeps the saved one unless you tick it. Overlapping files are fine.
- If a draw matches a saved draw a few days away, review offers to use that draw's date.

The same steps are on the Import results page. Portal menus differ between health systems, so each section links the portal's own help page.

## MyChart

Epic's portal, used by most hospitals and clinics, including Kaiser.

- **One test's full history:** Test Results → open the test → Compare result trends → Download. One PDF covers every past result of that test.
- **One report:** open the result and use Download or Print → Save as PDF. A screenshot works too.
- **Everything at once:** Sharing Hub → Yourself → Download or send a snapshot → All visits. Unzip the download and upload `My Health Summary.PDF`. It may leave out some results, so check it against Test Results.

Help: [MyChart: download results](https://www.mychart.org/l/en-us/help/download-results/)

## Quest Diagnostics

MyQuest website or app.

- Results → the menu next to a result → Download PDF.
- Quest gives one PDF per result, so download each one and upload them together.

Help: [MyQuest: print or download a result](https://myquest.questdiagnostics.com/myquest-faq1/MyQuest/3064.htm)

## Labcorp

Labcorp Patient portal or app.

- Open the visit from your dashboard and download its results PDF.
- Each visit is its own PDF; upload several at once.

Help: [Labcorp: test results](https://www.labcorp.com/patients/results)

## VA

My HealtheVet on VA.gov.

- Medical records → Lab and test results → Print, then Save as PDF.
- Or download a Blue Button report with VA laboratory results selected.

Help: [VA: review medical records online](https://www.va.gov/health-care/review-medical-records/)

## Other portals and paper reports

- Look for Download or Print, then choose Save as PDF.
- Otherwise take a screenshot, or a photo of the paper report: flat, well lit, the whole page in frame.

## Your own spreadsheet

CSV or XLSX, in either layout. Each sheet tab is read.

- **One row per result,** with columns named `Test`, `Value` and `Date`. `Units`, `Range`, `Flag` and `Lab` are optional.
- **One row per test,** with `Test`, `Reference range` and `Units` as the first three columns and a column for each date.
- **Dates:** `2025-03-04` is always safe. `3/4/2025` is read as month/day/year unless a date in the same sheet has a first number above 12; when the sheet cannot tell, the draft says so.
- **Numbers:** `1,500` is read as 1500 and `3,8` as 3.8. Write decimals with a point to leave no doubt. A CSV may be separated by commas, semicolons or tabs.
- A sheet, column or row the app leaves out is named in a warning on the draft.

## Limits

20 files and 64 MB per upload, 20 MB per file, 5,000 results per file.

## Not readable yet

Structured health-record exports, such as the XML files in a MyChart snapshot, MyChart's computer-readable export or an Apple Health export. Upload the PDF version instead.

## How files are handled

- Spreadsheets are parsed inside the app.
- PDFs are converted to text. Names, dates of birth, record numbers, addresses, phone numbers and emails are removed where the report labels them (`Patient:`, `DOB:`, `MRN:`), then an AI model on Cloudflare Workers AI reads the rest. An identifier printed without a label can still reach the model.
- Photos are sent to the model as they are, with everything visible in them.
- A file's name is never sent to the model.
- Discarding an import, or leaving a file out of one, deletes that upload. A saved upload stays until the last draw that uses it is deleted.
