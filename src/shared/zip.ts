// Just enough ZIP to open an .xlsx: list the entries, inflate the ones asked
// for with the runtime's own DecompressionStream, and refuse anything larger
// than the caller allows. Nothing is inflated until it is asked for, so an
// archive cannot make the reader allocate more than its limit.

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number }

const MAX_ENTRIES = 2_000

export class ZipError extends Error {}

export function listZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record sits at the end, before an optional comment of up to 65,535 bytes.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new ZipError('This file is not a ZIP archive.')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  if (count > MAX_ENTRIES || at === 0xffffffff) throw new ZipError('This archive has too many entries to read.')
  const entries: ZipEntry[] = []
  const decoder = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new ZipError('This archive is damaged.')
    const flags = view.getUint16(at + 8, true)
    const compressedSize = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const offset = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    if (flags & 1) throw new ZipError('This archive is password-protected.')
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError('This archive is too large to read.')
    entries.push({ name, method: view.getUint16(at + 10, true), compressedSize, size, offset })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}

/** One entry's bytes. Throws when it would inflate past `maxBytes`, whatever size its header claims. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== 0x04034b50) throw new ZipError('This archive is damaged.')
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (data.length !== entry.compressedSize) throw new ZipError('This archive is damaged.')
  if (entry.size > maxBytes) throw new ZipError('too large')
  if (entry.method === 0) return data
  if (entry.method !== 8) throw new ZipError('This archive uses a compression method that is not supported.')

  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new ZipError('too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let position = 0
  for (const chunk of chunks) {
    out.set(chunk, position)
    position += chunk.length
  }
  return out
}
