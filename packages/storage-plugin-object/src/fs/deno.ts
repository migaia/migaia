import { resolve } from 'node:path'
import type { IObjectFileIo } from './io.ts'
import { ObjectErrorText } from '../error-text.ts'
/** The Deno adapter uses native Deno filesystem calls rather than Node compatibility I/O. */
const runtime = (
  globalThis as typeof globalThis & {
    Deno: {
      mkdir(path: string, options: { recursive: boolean }): Promise<void>
      realPath(path: string): Promise<string>
      readTextFile(path: string): Promise<string>
      writeTextFile(path: string, text: string, options: { createNew: boolean }): Promise<void>
      writeFile(
        path: string,
        stream: ReadableStream<Uint8Array>,
        options: { createNew: boolean }
      ): Promise<void>
      open(
        path: string,
        options: { read: boolean }
      ): Promise<{
        seek(offset: number, whence: number): Promise<number>
        read(bytes: Uint8Array): Promise<number | null>
        close(): void
      }>
      rename(from: string, to: string): Promise<void>
      remove(path: string, options: { recursive: boolean }): Promise<void>
      readDir(path: string): AsyncIterable<{ name: string; isDirectory: boolean }>
    }
  }
).Deno
/** Deno file handles stay open for exactly the returned content snapshot. */
export const fileIo: IObjectFileIo = {
  async root(path) {
    const absolute = resolve(path)
    await runtime.mkdir(absolute, { recursive: true })
    return runtime.realPath(absolute)
  },
  mkdir: (path) => runtime.mkdir(path, { recursive: true }),
  readText: (path) => runtime.readTextFile(path),
  writeText: (path, text) => runtime.writeTextFile(path, text, { createNew: true }),
  write: (path, source) => runtime.writeFile(path, source, { createNew: true }),
  async read(path, start, end) {
    const handle = await runtime.open(path, { read: true })
    try {
      await handle.seek(start, 0)
    } catch (error) {
      try {
        handle.close()
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], ObjectErrorText.failed, { cause: error })
      }
      throw error
    }
    let remaining = end - start + 1
    let closed = false
    const close = async (): Promise<void> => {
      if (!closed) {
        closed = true
        handle.close()
      }
    }
    const source = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          if (remaining <= 0) {
            controller.close()
            return
          }
          const bytes = new Uint8Array(Math.min(64 * 1024, remaining))
          const size = await handle.read(bytes)
          if (size === null) controller.close()
          else {
            remaining -= size
            controller.enqueue(bytes.subarray(0, size))
          }
        },
        cancel: close
      },
      { highWaterMark: 0 }
    )
    return { source, close }
  },
  rename: (from, to) => runtime.rename(from, to),
  async remove(path) {
    try {
      await runtime.remove(path, { recursive: true })
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'NotFound') throw error
    }
  },
  async entries(path) {
    const result: { name: string; directory: boolean }[] = []
    for await (const entry of runtime.readDir(path))
      result.push({ name: entry.name, directory: entry.isDirectory })
    return result
  }
}
