import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import type { IObjectFileIo } from './io.ts'
/** Node reads hold an independent native file handle until EOF or explicit close. */
export const fileIo: IObjectFileIo = {
  async root(path) {
    const absolute = resolve(path)
    await fs.mkdir(absolute, { recursive: true })
    return fs.realpath(absolute)
  },
  async mkdir(path) {
    await fs.mkdir(path, { recursive: true })
  },
  readText: (path) => fs.readFile(path, 'utf8'),
  writeText: (path, text) => fs.writeFile(path, text, { flag: 'wx' }),
  async write(path, source) {
    await fs.writeFile(path, source as AsyncIterable<Uint8Array>, { flag: 'wx' })
  },
  async read(path, start, end) {
    const handle = await fs.open(path, 'r')
    const stream = handle.createReadStream({ start, end, autoClose: false })
    const source = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    let closed: Promise<void> | undefined
    return {
      source,
      close: () =>
        (closed ??= (async () => {
          stream.destroy()
          await handle.close()
        })())
    }
  },
  rename: (from, to) => fs.rename(from, to),
  remove: (path) => fs.rm(path, { recursive: true, force: true }),
  async entries(path) {
    return (await fs.readdir(path, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory()
    }))
  }
}
