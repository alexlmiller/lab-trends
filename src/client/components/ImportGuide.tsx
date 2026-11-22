// "Where to get your results": per-source steps for files the importer accepts.
// Portal menus differ between health systems, so each source links to its own
// help page. docs/importing.md carries the same steps; change both together.
// Research notes and sources: docs/lab-portal-exports.md.
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { linkClass } from './ui'

type Source = { name: string; detail: string; steps: ReactNode[]; note?: ReactNode; help?: { label: string; href: string } }

const DOCUMENT_SOURCES: Source[] = [
  {
    name: 'MyChart',
    detail: 'Epic, used by most hospitals and clinics, including Kaiser',
    steps: [
      <>
        <b>One test’s full history:</b> Test Results → open the test → Compare result trends → Download. One PDF covers every past result of that test.
      </>,
      <>
        <b>One report:</b> open the result and use Download or Print → Save as PDF. A screenshot works too.
      </>,
      <>
        <b>Everything at once:</b> Sharing Hub → Yourself → Download or send a snapshot → All visits. Unzip the download and upload <i>My Health Summary.PDF</i>. It may leave out some results, so check it against Test Results.
      </>,
    ],
    note: 'Menu names vary between health systems.',
    help: { label: 'MyChart help: download results', href: 'https://www.mychart.org/l/en-us/help/download-results/' },
  },
  {
    name: 'Quest Diagnostics',
    detail: 'MyQuest website or app',
    steps: ['Results → the menu next to a result → Download PDF.', 'Quest gives one PDF per result, so download each one and upload them together.'],
    help: { label: 'MyQuest help: print or download a result', href: 'https://myquest.questdiagnostics.com/myquest-faq1/MyQuest/3064.htm' },
  },
  {
    name: 'Labcorp',
    detail: 'Labcorp Patient portal or app',
    steps: ['Open the visit from your dashboard and download its results PDF.', 'Each visit is its own PDF; upload several at once.'],
    help: { label: 'Labcorp: test results', href: 'https://www.labcorp.com/patients/results' },
  },
  {
    name: 'VA',
    detail: 'My HealtheVet on VA.gov',
    steps: ['Medical records → Lab and test results → Print, then Save as PDF.', 'Or download a Blue Button report with VA laboratory results selected.'],
    help: { label: 'VA: review medical records online', href: 'https://www.va.gov/health-care/review-medical-records/' },
  },
  {
    name: 'Other portals and paper reports',
    detail: 'Anything you can see or hold',
    steps: [
      'Look for Download or Print, then choose Save as PDF.',
      'Otherwise take a screenshot, or a photo of the paper report: flat, well lit, the whole page in frame.',
    ],
  },
]

const SPREADSHEET: Source = {
  name: 'Your own spreadsheet',
  detail: 'CSV or XLSX',
  steps: [
    <>
      <b>One row per result,</b> with columns named <code>Test</code>, <code>Value</code> and <code>Date</code>. <code>Units</code>, <code>Range</code>, <code>Flag</code> and <code>Lab</code> are optional.
    </>,
    <>
      <b>Or one row per test,</b> with <code>Test</code>, <code>Reference range</code> and <code>Units</code> as the first three columns and a column for each date. Each sheet tab is read.
    </>,
    <>
      <b>Dates:</b> <code>2025-03-04</code> is always safe. <code>3/4/2025</code> is read as month/day/year unless a date in the same sheet has a first number above 12.
    </>,
    <>
      <b>Numbers:</b> <code>1,500</code> is read as 1500 and <code>3,8</code> as 3.8. Write decimals with a point to leave no doubt.
    </>,
  ],
}

export function ImportGuide({ documentImports }: { documentImports: boolean }) {
  const sources = documentImports ? [...DOCUMENT_SOURCES, SPREADSHEET] : [SPREADSHEET]
  return (
    <section>
      <h2 className="m-0 mb-1 text-[15px] font-semibold">Where to get your results</h2>
      <p className="m-0 mb-2 text-[13px] text-ink-dim">
        A report with many dates becomes one draw per date, and values you’ve already saved are skipped, so overlapping files are fine.
      </p>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {sources.map((s) => (
          <details key={s.name} className="group border-b border-line last:border-b-0">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 px-4 py-2.5 select-none hover:bg-sunken/60 [&::-webkit-details-marker]:hidden">
              <Icon name="chevron-right" className="shrink-0 translate-y-0.5 text-ink-faint transition-transform group-open:rotate-90" />
              <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                <span className="text-[14px] font-medium text-ink">{s.name}</span>
                <span className="text-[12.5px] text-ink-faint">{s.detail}</span>
              </span>
            </summary>
            <div className="grid gap-2 px-4 pt-0.5 pb-3 pl-10 text-[13px] text-ink-dim [&_b]:font-medium [&_b]:text-ink [&_code]:rounded [&_code]:bg-sunken [&_code]:px-1 [&_code]:text-[12px]">
              <ul className="m-0 grid list-disc gap-1.5 pl-4">
                {s.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
              {s.note || s.help ? (
                <p className="m-0 text-[12.5px] text-ink-faint">
                  {s.note} {s.help ? (
                    <a href={s.help.href} target="_blank" rel="noreferrer" className={linkClass}>
                      {s.help.label}
                    </a>
                  ) : null}
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>
      {documentImports ? (
        <p className="m-0 mt-2 text-[12.5px] text-ink-faint">
          Not readable yet: structured health-record exports, such as the XML files in a MyChart snapshot, MyChart’s computer-readable export or an Apple Health export. Upload the PDF version instead.
        </p>
      ) : null}
    </section>
  )
}
