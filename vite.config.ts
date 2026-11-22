import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev` runs entirely on this machine and needs no Cloudflare account;
// PDF and photo import fail there because they call Workers AI. `npm run dev:ai`
// (`vite --mode ai`) connects the AI binding to the account `wrangler login` used,
// and that usage is billed.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: mode === 'ai' })],
}))
