// Deploys in the order that is safe for the data: database migrations first, then the
// code. Migrations are additive, so the version already running keeps working while the
// new one goes out.
//
// A first deploy is the exception. The database does not exist until Wrangler creates it
// during the deploy, so there the code goes first and the migrations follow at once. Until
// they have run the app only says the database is not ready.
import { spawnSync } from 'node:child_process'

/** Runs Wrangler. `quiet` hides its output and never waits for an answer on the terminal. */
function wrangler(args, { quiet = false } = {}) {
  return spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
  })
}

function run(args) {
  const result = wrangler(args)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const migrate = () => run(['d1', 'migrations', 'apply', 'DB', '--remote'])
const deploy = () => run(['deploy'])

// Listing migrations changes nothing and fails in a recognisable way when the database is missing.
const probe = wrangler(['d1', 'migrations', 'list', 'DB', '--remote'], { quiet: true })
const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`

if (probe.status === 0) {
  migrate()
  deploy()
} else if (/Couldn't find a D1 DB/i.test(output)) {
  console.log('No database yet. Deploying first so Wrangler creates it, then applying migrations.')
  deploy()
  migrate()
} else {
  process.stderr.write(output)
  process.exit(probe.status ?? 1)
}
