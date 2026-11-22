export type AppEnv = {
  Bindings: Env
  /** email: the signed-in user. owner: may manage who has access. actor: who to record in audit fields ("… (via MCP)" for agent changes). */
  Variables: { email: string; owner: boolean; actor: string }
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
  /**
   * "read-only" makes a public demo: no sign-in, reads only, and only while every person in
   * the database is a demo person (id starting "demo"). Never set it on a deployment with real records.
   */
  DEMO_MODE?: string
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

export function sourceKindFor(filename: string, mime: string | null): 'pdf' | 'image' | 'csv' | 'xlsx' | null {
  const name = filename.toLowerCase()
  const type = (mime ?? '').toLowerCase()
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf'
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/.test(name) || type.startsWith('image/')) return 'image'
  if (name.endsWith('.csv') || type === 'text/csv') return 'csv'
  if (/\.xls[xm]$/.test(name) || type.includes('spreadsheetml')) return 'xlsx'
  return null
}

/** Workers AI refuses some models on the Workers Free plan (its error 5035). Trying again cannot help. */
export function isPlanRefusal(err: unknown): boolean {
  return /\b5035\b|not available on the workers free plan/i.test(err instanceof Error ? err.message : String(err))
}

/** Shown on the import when the model is refused for the plan, in place of Cloudflare's raw error. */
export const PLAN_REFUSAL_MESSAGE =
  'Reading PDFs and photos needs the Workers Paid plan: the model this app uses is not offered on Workers Free. Upgrade under Workers plans in the Cloudflare dashboard, then choose Try again. Spreadsheets and typing results in work on the free plan.'

/** Workers AI capacity/rate errors and upstream hiccups are worth retrying. */
export function isTransient(err: unknown): boolean {
  if (isPlanRefusal(err)) return false
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase()
  // \b keeps longer error codes such as 5035 from reading as an HTTP 503.
  return /capacity|3040|429|rate limit|too many|timeout|timed out|temporar|overloaded|\b5\d\d\b|network/.test(m)
}

/** For logs. A JSON parser quotes the text it choked on, which here is report or request content. */
export function logMessage(err: unknown): string {
  if (err instanceof SyntaxError) return 'SyntaxError: invalid JSON'
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}
