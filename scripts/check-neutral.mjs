// Fails when account-specific values are committed. Run in this repository's CI only:
// a deployed copy legitimately has its own IDs written into wrangler.jsonc.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const problems = []
const config = readFileSync('wrangler.jsonc', 'utf8')
for (const key of ['account_id', 'database_id', 'preview_database_id', 'routes', 'route', 'vars', 'zone_id']) {
  if (new RegExp(`^\\s*"${key}"\\s*:`, 'm').test(config)) problems.push(`wrangler.jsonc sets "${key}"`)
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const checks = [
  // example.com, example.invalid, noreply addresses and the SSH-style git@ are fine.
  { name: 'an email address', re: /[\w.+-]+@(?!example\.|users\.noreply\.|anthropic\.com|localhost)[\w-]+\.[a-z]{2,}/gi },
  { name: 'a Cloudflare Access team domain', re: /\b(?!example\b|your-team\b|team\b)[a-z0-9-]+\.cloudflareaccess\.com/gi },
  { name: 'a 32-character hex ID', re: /\b[0-9a-f]{32}\b/g },
]
const skip = /^(package-lock\.json|src\/worker\/worker-configuration\.d\.ts|scripts\/check-neutral\.mjs|migrations\/0002_seed_markers\.sql|test\/)/
for (const file of files) {
  if (skip.test(file) || /\.(png|jpg|ico|woff2?)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const { name, re } of checks) {
    for (const match of text.matchAll(re)) problems.push(`${file} contains ${name}: ${match[0]}`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('No account-specific values found.')
