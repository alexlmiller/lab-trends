// The MCP endpoint as a client sees it: the protocol handshake, the tool list,
// and tools that read and write through the same rules as the web app.
import { beforeAll, describe, expect, it } from 'vitest'
import { forgetCatalog } from '../src/worker/catalog'
import worker from '../src/worker/index'
import { forgetUpgrade } from '../src/worker/upgrade'
import { testEnv } from './helpers'

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
let env: Env
let id = 0

async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const res = await worker.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }),
    env,
    ctx,
  )
  const text = await res.text()
  // A reply is one JSON body or one server-sent event carrying it.
  const json = text.startsWith('{') ? text : (text.split('\n').find((line) => line.startsWith('data: '))?.slice(6) ?? 'null')
  return { res, message: JSON.parse(json) as { result?: Record<string, unknown>; error?: { message: string } } | null }
}

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const { message } = await rpc('tools/call', { name, arguments: args })
  const result = message!.result as { content: { text: string }[]; isError?: boolean }
  return { failed: Boolean(result.isError), text: result.content[0].text, data: result.isError ? null : (JSON.parse(result.content[0].text) as Record<string, unknown>) }
}

beforeAll(async () => {
  forgetCatalog()
  forgetUpgrade()
  env = testEnv().env
  for (const name of ['Sam', 'Samantha']) {
    await worker.fetch(new Request('http://localhost/api/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: name }) }), env, ctx)
  }
})

describe('MCP', () => {
  it('answers the handshake and lists its tools, marking the ones that change or remove data', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.res.status).toBe(200)
    expect((init.message!.result!.serverInfo as { name: string }).name).toBe('lab-trends')
    const tools = (await rpc('tools/list')).message!.result!.tools as { name: string; annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } }[]
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_overview', 'draft_results', 'commit_results', 'delete_result', 'delete_event']))
    for (const name of ['unwatch_tests', 'set_target', 'update_draw', 'discard_draft', 'commit_results', 'update_result', 'delete_result', 'update_event', 'delete_event']) {
      expect(tools.find((t) => t.name === name)?.annotations.destructiveHint, name).toBe(true)
    }
    for (const t of tools) expect(t.annotations.readOnlyHint === true && t.annotations.destructiveHint === true, t.name).toBe(false)
  })

  it('never guesses which person a partial name means', async () => {
    expect((await call('list_people')).data).toMatchObject({ people: [{ name: 'Sam' }, { name: 'Samantha' }] })
    expect((await call('list_markers', { person: 'Sam' })).data).toMatchObject({ person: { name: 'Sam' } })
    expect((await call('list_markers', { person: 'Saman' })).data).toMatchObject({ person: { name: 'Samantha' } })
    const ambiguous = await call('list_markers', { person: 'Sa' })
    expect(ambiguous.failed).toBe(true)
    expect(ambiguous.text).toMatch(/could be Sam or Samantha/)
  })

  it('drafts, saves and reads back results through the same rules as the app', async () => {
    const draft = (await call('draft_results', { person: 'Sam', draw_date: '2025-03-04', results: [{ test: 'Glucose', value: '90', units: 'mg/dL', reference: '70-99' }, { test: 'Glucose', value: '160' }] })).data!
    expect((draft.rows as { warnings?: string[] }[])[1].warnings?.join(' ')).toMatch(/Also listed as 90/)
    const saved = (await call('commit_results', { person: 'Sam', draft_id: draft.draft_id })).data!
    expect(saved).toMatchObject({ saved: true, results_created: 1, same_day_conflicts: [{ kept: '90', dropped: '160' }] })
    const draw = (await call('get_draw', { person: 'Sam', date: '2025-03-04' })).data!
    expect((draw.draws as { results: { marker: string; value: string; status: string }[] }[])[0].results).toMatchObject([{ marker: 'Glucose', value: '90', status: 'in' }])
  })

  it('refuses a browser on another site, and sends no CORS headers', async () => {
    const elsewhere = await rpc('tools/list', {}, { Origin: 'https://elsewhere.example' })
    expect(elsewhere.res.status).toBe(403)
    const own = await rpc('tools/list', {}, { Origin: 'http://localhost' })
    expect(own.res.status).toBe(200)
    expect([...own.res.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([])
    expect(own.res.headers.get('Cache-Control')).toBe('no-store')
  })
})
