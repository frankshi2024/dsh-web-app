/**
 * asar.mjs — minimal read-only asar reader (zero deps, Node 18+).
 *
 * Used by test/compat.test.mjs to inspect the packed harness build
 * (resources/app.asar) without extracting it. Format (two nested Chromium
 * Pickles): [u32 =4][u32 headerPickleSize] then the header pickle:
 * [u32 payloadSize][u32 jsonByteLen][json UTF-8 (4-aligned)]…file blobs.
 * File `offset`s in the header JSON are relative to (8 + headerPickleSize).
 */
import fs from 'node:fs'

export function openAsar(asarPath) {
  const fd = fs.openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(8)
    fs.readSync(fd, head, 0, 8, 0)
    const headerPickleSize = head.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerPickleSize)
    fs.readSync(fd, headerBuf, 0, headerPickleSize, 8)
    const jsonLen = headerBuf.readUInt32LE(4)
    const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonLen))
    const dataStart = 8 + headerPickleSize

    // Flatten the file tree once: map of normalized path → { offset, size }
    const files = new Map()
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const p = prefix === '' ? name : `${prefix}/${name}`
        if (child.files !== undefined) walk(child, p)
        else files.set(p, { offset: Number(child.offset ?? 0), size: Number(child.size ?? 0) })
      }
    }
    walk(header, '')

    const readFile = (p) => {
      const entry = files.get(p)
      if (entry === undefined) return null
      const buf = Buffer.alloc(entry.size)
      fs.readSync(fd, buf, 0, entry.size, dataStart + entry.offset)
      return buf
    }

    return {
      files,
      readFile,
      readText: (p) => readFile(p)?.toString('utf8') ?? null,
      list: (prefix) => Array.from(files.keys()).filter((p) => p.startsWith(prefix)),
      close: () => fs.closeSync(fd),
    }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}
