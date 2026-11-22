import { createBrowserRouter, Link } from 'react-router'
import { Empty } from './components/ui'
import { Layout } from './pages/Layout'
import { ReportBriefPage } from './pages/ReportBrief'
import { CorrelationsPage } from './pages/Correlations'
import { DrawsPage } from './pages/Draws'
import { EventsPage } from './pages/Events'
import { GridPage } from './pages/Grid'
import { ImportPage, ImportReviewPage } from './pages/Import'
import { MarkersAdminPage } from './pages/MarkersAdmin'
import { OverviewPage } from './pages/Overview'
import { SettingsPage } from './pages/Settings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <ReportBriefPage /> },
      { path: 'history', lazy: async () => ({ Component: (await import('./pages/History')).HistoryPage }) },
      { path: 'watchlist', lazy: async () => ({ Component: (await import('./pages/Watchlist')).WatchlistPage }) },
      { path: 'markers', element: <OverviewPage /> },
      { path: 'grid', element: <GridPage /> },
      { path: 'correlations', element: <CorrelationsPage /> },
      { path: 'draws', element: <DrawsPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'import/:batchId', element: <ImportReviewPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'catalog', element: <MarkersAdminPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])


function NotFound() {
  return (
    <Empty title="This page doesn’t exist">
      <Link to="/">Go to Latest results</Link>
    </Empty>
  )
}
