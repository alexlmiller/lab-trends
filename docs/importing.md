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

## Not readable yet

Structured health-record exports, such as the XML files in a MyChart snapshot, MyChart's computer-readable export or an Apple Health export. Upload the PDF version instead.

## How files are handled

Spreadsheets are parsed inside the app. PDFs are converted to text, scrubbed of names, dates of birth, record numbers and contact details, then read by an AI model on Cloudflare Workers AI. Photos are sent to the model as-is.
