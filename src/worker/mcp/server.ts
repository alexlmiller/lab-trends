// Remote MCP server at /mcp on the app's own hostname.
//
// Cloudflare Access is the OAuth server: with managed OAuth on for the Access
// application, an MCP client gets a 401 pointing at Access's OAuth discovery, the
// user signs in through the usual Access login, and requests arrive here with the
// same Cf-Access-Jwt-Assertion a browser session carries. This Worker only verifies
// that identity (the same rules as /api) and serves MCP.
import { createMcpHandler } from '@modelcontextprotocol/server'
import { accessIdentity, denial } from '../auth'
import { logMessage } from '../lib'
import { buildServer, type ApiFetch } from './tools'

export async function mcpFetch(request: Request, env: Env, ctx: ExecutionContext, apiFetch: ApiFetch): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname !== '/mcp') return secured(new Response('Not Found', { status: 404 }))
  // An MCP client is a program, not a page. A browser on another site would bring the person's Access
  // session with it, so any request that names a different origin is refused, and no CORS header is ever sent.
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return secured(Response.json({ error: 'This request came from another site.' }, { status: 403 }))
  const who = await accessIdentity(request, env)
  if (!who.ok) return denial(who)
  const { email, owner } = who
  const handler = createMcpHandler(() => buildServer({ email, owner, apiFetch, env, ctx }), {
    onerror: (err) => console.error('mcp', logMessage(err)),
  })
  return secured(await handler.fetch(request))
}

/** Tool results are health records: never cached, never guessed at as another content type. */
function secured(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith('access-control-')) headers.delete(name)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
