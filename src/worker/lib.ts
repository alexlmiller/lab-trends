export type AppEnv = {
  Bindings: Env
  /**
   * email: the signed-in user. owner: may manage who has access. actor: who to record in audit fields
   * ("… (via MCP)" for agent changes). sid: the person a /subjects/:sid route is about, once known to exist.
   */
  Variables: { email: string; owner: boolean; actor: string; sid: string }
}

/**
 * Optional Worker variables and secrets, set in Cloudflare rather than in
 * wrangler.jsonc so the repository stays free of account-specific values.
 */
export type Settings = {
  /** Trust only this Access application instead of the one learned at first sign-in. Set both or neither. */
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  /** The owner's email. Without it, the first person to sign in becomes the owner. */
  OWNER_EMAIL?: string
  /** Local development only: sign every request in as this address on localhost. */
  DEV_AUTH_EMAIL?: string
  /** Any env.AI.run() model id. EXTRACTION_MODEL reads PDF text; VISION_MODEL reads photos. */
  EXTRACTION_MODEL?: string
  VISION_MODEL?: string
  AI_GATEWAY_ID?: string
}

export function settings(env: Env): Settings {
  return env as unknown as Settings
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// ─── Request bodies ─────────────────────────────────────────────────────
// Nothing a client sends is trusted to have the type the route expects: a
// wrong type is a 400 here, never a value saved as it came or a 500 later.

/** The request body, which must be a JSON object. */
export async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Send a JSON object')
  return value as Record<string, unknown>
}

/** A trimmed string of at most `max` characters; null when missing or empty. */
export function text(value: unknown, field: string, max = 500): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new HttpError(400, `${field} is longer than ${max} characters`)
  return trimmed || null
}

/** A list of at most `max` strings. */
export function strings(value: unknown, field: string, max = 1_000): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((v) => typeof v !== 'string')) throw new HttpError(400, `${field} must be a list of text values`)
  return value as string[]
}

/** A finite number; null when missing. */
export function number(value: unknown, field: string): number | null {
  if (value == null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${field} must be a number`)
  return value
}

// ─── Uploads ────────────────────────────────────────────────────────────

export type FileKind = 'pdf' | 'image' | 'csv' | 'xlsx'

export function sourceKindFor(filename: string, mime: string | null): FileKind | null {
  const name = filename.toLowerCase()
  const type = (mime ?? '').toLowerCase()
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf'
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/.test(name) || type.startsWith('image/')) return 'image'
  if (name.endsWith('.csv') || type === 'text/csv') return 'csv'
  if (/\.xls[xm]$/.test(name) || type.includes('spreadsheetml')) return 'xlsx'
  return null
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' }

const FILE_TYPES: Record<Exclude<FileKind, 'image'>, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const SERVED_TYPES = new Set([...Object.values(FILE_TYPES), ...Object.values(IMAGE_TYPES)])

/** The content type an upload is stored and served with: one of a fixed list, whatever the uploader claimed. */
export function contentTypeFor(filename: string, kind: FileKind | null = sourceKindFor(filename, null)): string {
  if (kind === 'image') return IMAGE_TYPES[filename.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream'
  return kind ? FILE_TYPES[kind] : 'application/octet-stream'
}

/** The type to serve a stored upload with: the stored one when it is on the list, else what the name implies. */
export function servedType(filename: string, stored: string | null): string {
  return stored && SERVED_TYPES.has(stored) ? stored : contentTypeFor(filename)
}

// ─── Errors ─────────────────────────────────────────────────────────────

/** Workers AI refuses some models on the Workers Free plan (its error 5035). Trying again cannot help. */
export function isPlanRefusal(err: unknown): boolean {
  return /\b5035\b|not available on the workers free plan/i.test(err instanceof Error ? err.message : String(err))
}

/** Shown on the import when the model is refused for the plan, in place of Cloudflare's raw error. */
export const PLAN_REFUSAL_MESSAGE =
  'The model set for this app (EXTRACTION_MODEL or VISION_MODEL) is not offered on the Workers Free plan. Remove that setting on the Worker to use the default model, which is, or upgrade under Workers plans in the Cloudflare dashboard. Then choose Try again.'

/** The account has used its free Workers AI allowance for the day (error 3036, sent as an HTTP 429). It resets at 00:00 UTC. */
export function isDailyLimit(err: unknown): boolean {
  return /\b3036\b|daily free allocation/i.test(err instanceof Error ? err.message : String(err))
}

/** Shown on the import when the daily allowance is used up, in place of Cloudflare's raw error. */
export const DAILY_LIMIT_MESSAGE =
  "Today's free Workers AI allowance on this Cloudflare account is used up, so this file was not read. The allowance resets at midnight UTC: choose Try again after that. The Workers Paid plan removes the daily limit."

/** The account cannot run the model at all right now. Every part of a file would fail the same way, and trying again soon cannot help. */
export function isAccountRefusal(err: unknown): boolean {
  return isPlanRefusal(err) || isDailyLimit(err)
}

/** Workers AI capacity/rate errors and upstream hiccups are worth retrying. */
export function isTransient(err: unknown): boolean {
  if (isAccountRefusal(err)) return false
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase()
  // \b keeps longer error codes such as 5035 from reading as an HTTP 503.
  return /capacity|3040|429|rate limit|too many|timeout|timed out|temporar|overloaded|\b5\d\d\b|network/.test(m)
}

/** For logs and for errors shown to people. A JSON parser quotes the text it choked on, which here is report or request content. */
export function logMessage(err: unknown): string {
  if (err instanceof SyntaxError) return 'SyntaxError: invalid JSON'
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}
