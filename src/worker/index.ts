// The Worker: the JSON API under /api, the MCP endpoint at /mcp, and the queue
// consumer that reads uploaded PDFs and photos. Everything else is static assets.
import { Hono } from 'hono'
import { requireAccess, sameOriginWrites } from './auth'
import { processCandidate } from './imports'
import { HttpError, logMessage, type AppEnv } from './lib'
import { imports } from './routes/imports'
import { markers } from './routes/markers'
import { people, subject } from './routes/people'
import { records } from './routes/records'
import { upgradeData } from './upgrade'

const app = new Hono<AppEnv>().basePath('/api')

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400)
  console.error('unhandled', logMessage(err))
  return c.json({ error: 'Internal error' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))
app.use('*', sameOriginWrites)
app.use('*', requireAccess)
app.use('*', async (c, next) => {
  // Stored rows are brought up to the current rules a step at a time after a deploy.
  await upgradeData(c.env)
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
})
app.use('/subjects/:sid', subject)
app.use('/subjects/:sid/*', subject)

app.route('/', people)
app.route('/', markers)
app.route('/', records)
app.route('/', imports)

export default {
  async fetch(request, env, ctx) {
    // run_worker_first sends only /api/* and /mcp here; everything else is static assets.
    const { pathname } = new URL(request.url)
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      // The MCP SDK is most of the Worker's code, so it is loaded only for the requests that use it.
      const { mcpFetch } = await import('./mcp/server')
      return mcpFetch(request, env, ctx, app.fetch)
    }
    return app.fetch(request, env, ctx)
  },
  async queue(batch: MessageBatch<{ candidateId: string }>, env: Env) {
    for (const message of batch.messages) {
      const outcome = await processCandidate(env, message.body.candidateId)
      if (outcome === 'retry') message.retry({ delaySeconds: 20 * message.attempts })
      else message.ack()
    }
  },
} satisfies ExportedHandler<Env, { candidateId: string }>
