import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IObjectFileIo } from './io.js'
/** Structural declarations describe only the selected runtime's actual native file API. */
const runtime = (
  globalThis as typeof globalThis & {
    Bun: {
      file(path: string): {
        text(): Promise<string>
        slice(start: number, end: number): { stream(): ReadableStream<Uint8Array> }
      }
      write(path: string, value: string | ReadableStream<Uint8Array>): Promise<number>
    }
  }
).Bun
/** Bun owns file content reads and writes; its builtin filesystem owns directory metadata. */
export const fileIo: IObjectFileIo = {
  async root(path) {
    const absolute = resolve(path)
    await fs.mkdir(absolute, { recursive: true })
    return fs.realpath(absolute)
  },
  async mkdir(path) {
    await fs.mkdir(path, { recursive: true })
  },
  readText: (path) => runtime.file(path).text(),
  async writeText(path, text) {
    await runtime.write(path, text)
  },
  async write(path, source) {
    await runtime.write(path, source)
  },
  async read(path, start, end) {
    const source = runtime
      .file(path)
      .slice(start, end + 1)
      .stream()
    return { source, close: async () => undefined }
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
