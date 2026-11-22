// Who is signed in, who may sign in, and the people whose records are kept.
import { Hono, type MiddlewareHandler } from 'hono'
import { forgetTrust, instanceState } from '../auth'
import { modelsFor } from '../extraction'
import { HttpError, jsonBody, newId, nowIso, settings, text, type AppEnv } from '../lib'
import { deleteSubject } from '../storage'

export const people = new Hono<AppEnv>()

// ─── /subjects/:sid/… ───────────────────────────────────────────────────

/** How long an isolate trusts that a person it has seen still exists. */
const SUBJECT_TTL_MS = 60_000
const seen = new Map<string, number>()

/** Every route about one person: 404 unless the person exists, then `sid` is set. */
export const subject: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sid = c.req.param('sid') ?? ''
  if ((seen.get(sid) ?? 0) < Date.now()) {
    if (!(await c.env.DB.prepare('SELECT 1 FROM subjects WHERE id = ?').bind(sid).first())) throw new HttpError(404, 'Person not found')
    seen.set(sid, Date.now() + SUBJECT_TTL_MS)
  }
  c.set('sid', sid)
  return next()
}

// ─── Identity ───────────────────────────────────────────────────────────

/** What /me returns; MCP tools read it without going through HTTP. */
export async function loadMe(env: Env, who: { email: string; owner: boolean }) {
  const subjects = await env.DB.prepare('SELECT id, display_name FROM subjects ORDER BY created_at').all<{ id: string; display_name: string }>()
  return {
    email: who.email,
    owner: who.owner,
    subjects: subjects.results,
    document_imports: Boolean(env.EXTRACTIONS),
    extraction_models: modelsFor(env),
    ai_gateway: Boolean(settings(env).AI_GATEWAY_ID),
  }
}

people.get('/me', async (c) => c.json(await loadMe(c.env, { email: c.get('email'), owner: c.get('owner') })))

// ─── Who has access ─────────────────────────────────────────────────────

people.get('/instance', async (c) => {
  const state = await instanceState(c.env)
  return c.json({
    // No owner on record only in local development, where the signed-in address is the owner.
    owner_email: state.ownerSetting ?? state.row?.owner_email ?? c.get('email'),
    access: state.trusted ? { team_domain: state.trusted.team, source: state.configured ? 'settings' : 'first_sign_in' } : null,
    // Only the owner manages the list, so only the owner is shown other people's addresses.
    people: c.get('owner') ? state.people : [],
  })
})

people.post('/instance/people', async (c) => {
  if (!c.get('owner')) throw new HttpError(403, 'Only the owner can change who has access')
  const email = text((await jsonBody(c)).email, 'Email', 254)?.toLowerCase() ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter an email address')
  await c.env.DB.prepare('INSERT OR IGNORE INTO allowed_users (email, added_at, added_by) VALUES (?, ?, ?)').bind(email, nowIso(), c.get('actor')).run()
  forgetTrust()
  return c.json({ ok: true }, 201)
})

people.delete('/instance/people/:email', async (c) => {
  if (!c.get('owner')) throw new HttpError(403, 'Only the owner can change who has access')
  await c.env.DB.prepare('DELETE FROM allowed_users WHERE email = ?').bind(c.req.param('email').toLowerCase()).run()
  forgetTrust()
  return c.json({ ok: true })
})

// ─── People with records ────────────────────────────────────────────────

people.post('/subjects', async (c) => {
  const name = text((await jsonBody(c)).display_name, 'Name', 80)
  if (!name) throw new HttpError(400, 'Name is required')
  const id = newId('sb')
  const now = nowIso()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO subjects (id, display_name, created_at) VALUES (?, ?, ?)').bind(id, name, now),
    c.env.DB.prepare('INSERT INTO preferences (subject_id, updated_at) VALUES (?, ?)').bind(id, now),
  ])
  return c.json({ id, display_name: name }, 201)
})

people.patch('/subjects/:sid', async (c) => {
  const name = text((await jsonBody(c)).display_name, 'Name', 80)
  if (!name) throw new HttpError(400, 'Name is required')
  await c.env.DB.prepare('UPDATE subjects SET display_name = ? WHERE id = ?').bind(name, c.get('sid')).run()
  return c.json({ ok: true })
})

/** Delete a person and everything recorded about them. Nothing is kept, so the name has to be confirmed. */
people.delete('/subjects/:sid', async (c) => {
  if (!c.get('owner')) throw new HttpError(403, 'Only the owner can delete a person')
  const sid = c.get('sid')
  const row = await c.env.DB.prepare('SELECT display_name FROM subjects WHERE id = ?').bind(sid).first<{ display_name: string }>()
  if (!row) throw new HttpError(404, 'Person not found')
  if (c.req.query('confirm')?.trim().toLowerCase() !== row.display_name.trim().toLowerCase()) throw new HttpError(400, 'Type the person’s name to confirm')
  await deleteSubject(c.env, sid)
  seen.delete(sid)
  return c.json({ ok: true })
})
