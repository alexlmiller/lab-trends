// Test stand-ins for the Worker's bindings. The database is Node's built-in
// SQLite with the real migrations applied, so the SQL under test is the SQL
// production runs: a typo, a broken foreign key or an unbound value fails here.
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { deflateRawSync } from 'node:zlib'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

type Meta = { changes: number; rows_read: number }
type Outcome = { results: Record<string, unknown>[]; meta: Meta }

export type TestDatabase = D1Database & {
  /** Run SQL directly, outside the code under test. */
  query: <T = Record<string, unknown>>(sql: string, ...args: SQLInputValue[]) => T[]
  /** How SQLite would run a statement, as EXPLAIN QUERY PLAN lines. */
  plan: (sql: string, ...args: SQLInputValue[]) => string[]
  /** Every statement the code under test has run. */
  log: string[]
  /** Round trips to the database: a batch is one, however many statements it carries. */
  trips: { count: number }
}

export function testDatabase(): TestDatabase {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).sort()) db.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  const log: string[] = []
  const trips = { count: 0 }
  const trip = <T>(work: () => T): T => {
    trips.count++
    return work()
  }
  const run = (sql: string, args: SQLInputValue[]): Outcome => {
    log.push(sql)
    const stmt = db.prepare(sql)
    if (/^\s*(?:SELECT|WITH)\b|\bRETURNING\b/i.test(sql)) {
      const results = stmt.all(...args) as Record<string, unknown>[]
      return { results, meta: { changes: /^\s*(?:SELECT|WITH)\b/i.test(sql) ? 0 : results.length, rows_read: 0 } }
    }
    return { results: [], meta: { changes: Number(stmt.run(...args).changes), rows_read: 0 } }
  }
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    sql,
    args,
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    first: async () => trip(() => run(sql, args).results[0] ?? null),
    all: async () => trip(() => run(sql, args)),
    run: async () => trip(() => run(sql, args)),
  })
  return {
    prepare: (sql: string) => statement(sql),
    // A D1 batch is one transaction: all of it happens or none of it does.
    batch: async (statements: { sql: string; args: SQLInputValue[] }[]) => {
      trips.count++
      db.exec('BEGIN')
      try {
        const out = statements.map((s) => run(s.sql, s.args))
        db.exec('COMMIT')
        return out
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    query: (sql: string, ...args: SQLInputValue[]) => db.prepare(sql).all(...args),
    plan: (sql: string, ...args: SQLInputValue[]) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((r) => r.detail),
    log,
    trips,
  } as unknown as TestDatabase
}

/** R2 stand-in: a map of key to bytes. */
export function testBucket() {
  const objects = new Map<string, Uint8Array>()
  return {
    objects,
    put: async (key: string, value: ArrayBuffer | Uint8Array | string) => void objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)),
    get: async (key: string) => {
      const bytes = objects.get(key)
      return bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), body: bytes } : null
    },
    delete: async (keys: string | string[]) => void [keys].flat().forEach((k) => objects.delete(k)),
    list: async ({ prefix = '' }: { prefix?: string } = {}) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  }
}

export function testEnv() {
  const DB = testDatabase()
  const FILES = testBucket()
  const sent: unknown[] = []
  const env = { DB, FILES, EXTRACTIONS: { send: async (message: unknown) => void sent.push(message) }, DEV_AUTH_EMAIL: 'owner@example.com' } as unknown as Env
  return { env, DB, FILES, sent }
}

/** A .zip (and so an .xlsx) from named parts, deflated the way spreadsheet programs write them. */
export function zip(parts: Record<string, string>, options: { claimSize?: number } = {}): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(parts)) {
    const raw = encoder.encode(text)
    const data = new Uint8Array(deflateRawSync(raw))
    const nameBytes = encoder.encode(name)
    const size = options.claimSize ?? raw.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(8, 8, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, size, true)
    local.setUint16(26, nameBytes.length, true)
    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(10, 8, true)
    header.setUint32(20, data.length, true)
    header.setUint32(24, size, true)
    header.setUint16(28, nameBytes.length, true)
    header.setUint32(42, offset, true)
    chunks.push(new Uint8Array(local.buffer), nameBytes, data)
    central.push(new Uint8Array(header.buffer), nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, Object.keys(parts).length, true)
  end.setUint16(10, Object.keys(parts).length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of all) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** A one-sheet workbook from rows of cell XML, with optional shared strings, styles and workbook attributes. */
export function workbook(sheetRows: string, extra: { sharedStrings?: string; styles?: string; workbookPr?: string; sheets?: Record<string, string> } = {}): Uint8Array {
  const sheets = extra.sheets ?? { Labs: sheetRows }
  const names = Object.keys(sheets)
  return zip({
    'xl/workbook.xml': `<workbook>${extra.workbookPr ?? ''}<sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    ...(extra.sharedStrings ? { 'xl/sharedStrings.xml': extra.sharedStrings } : {}),
    ...(extra.styles ? { 'xl/styles.xml': extra.styles } : {}),
    ...Object.fromEntries(names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${sheets[n]}</sheetData></worksheet>`])),
  })
}
