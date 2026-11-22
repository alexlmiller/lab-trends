// Remote MCP server at /mcp on the app's own hostname.
//
// Cloudflare Access is the OAuth server: with managed OAuth on for the Access
// application, an MCP client gets a 401 pointing at Access's OAuth discovery, the
// user signs in through the usual Access login, and requests arrive here with the
// same Cf-Access-Jwt-Assertion a browser session carries. This Worker only verifies
// that identity (the same rules as /api) and serves MCP.
import { createMcpHandler } from 'agents/mcp/server'
import { accessIdentity, denial } from '../auth'
import { buildServer, type ApiFetch } from './tools'

export function isMcpRequest(url: URL): boolean {
  return url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')
}

export async function mcpFetch(request: Request, env: Env, ctx: ExecutionContext, apiFetch: ApiFetch): Promise<Response> {
  const who = await accessIdentity(request, env)
  if (!who.ok) return denial(who)
  const { email, owner } = who
  const handler = createMcpHandler(() => buildServer({ email, owner, apiFetch, env, ctx }), {
    route: '/mcp',
    allowedHostnames: [new URL(request.url).hostname],
    authContext: { props: { email } },
  })
  return handler(request, env, ctx)
}
