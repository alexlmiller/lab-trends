import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './router'
// Bundled with the app and served from its own address; nothing is fetched from a font host.
import '@fontsource-variable/inter/wght.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
