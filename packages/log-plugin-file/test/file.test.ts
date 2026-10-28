import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filePlugin } from '../src/index.ts'
import { filePlugin as browserFilePlugin } from '../src/index.browser.ts'

/** One injected writer records the exact append boundary and rotation order. */
class MemoryWriter {
  /** Each delivery produces one append call containing complete NDJSON records. */
  readonly writes: Array<{ path: string; text: string }> = []
  /** Rotations are independent capabilities and happen after the triggering append. */
  readonly rotations: string[] = []
  /** Record a complete atomic append attempt. */
  async append(path: string, text: string): Promise<void> {
    this.writes.push({ path, text })
  }
  /** Record a requested rotation without pretending the default writer implements it. */
  async rotate(path: string): Promise<void> {
    this.rotations.push(path)
  }
}

/** A batch is one NDJSON append, followed by an explicitly supported rotation. */
async function injectedWriter(): Promise<void> {
  /** The fake writer owns all observable filesystem effects. */
  const writer = new MemoryWriter()
  /** Batching is supplied by the host instead of a private file queue. */
  const host = createLogHost({
    plugins: [
      filePlugin({
        path: 'memory.ndjson',
        writer,
        rotate: { maxEntries: 2 },
        features: [batchFeature({ maxSize: 2 })]
      })
    ]
  })
  host.log('info', 'one')
  host.log('info', 'two')
  await host.flush()
  expect(writer.writes).toHaveLength(1)
  expect(writer.writes[0].path).toBe('memory.ndjson')
  expect(writer.writes[0].text.endsWith('\n')).toBe(true)
  expect(writer.writes[0].text.trim().split('\n')).toHaveLength(2)
  expect(writer.rotations).toEqual(['memory.ndjson'])
  await host.shutdown('manual')
}
it('batches entries into one injected append and rotates after the threshold', injectedWriter)

/** Native Node appends two independent batches instead of overwriting the destination. */
async function nodeAppend(): Promise<void> {
  /** The test-owned temporary destination cannot affect an application file. */
  const directory = await mkdtemp(join(tmpdir(), 'log-plugin-file-'))
  /** Both operations use the same destination so overwrite would lose the first line. */
  const path = join(directory, 'entries.ndjson')
  /** The root Node entry chooses its native append capability. */
  const host = createLogHost({ plugins: [filePlugin({ path })] })
  host.log('info', 'first')
  await host.flush()
  host.log('info', 'second')
  await host.flush()
  expect((await readFile(path, 'utf8')).trim().split('\n').map(parseMessage)).toEqual([
    'first',
    'second'
  ])
  await host.shutdown('manual')
}

/** Parse only the business field required by the append-preservation assertion. */
function parseMessage(line: string): string {
  return JSON.parse(line).message
}
it('appends separate native Node batches to the same file', nodeAppend)

/** Unsupported defaults and rotation capability mismatches are creation errors. */
function writerAdmission(): void {
  expect(() => browserFilePlugin({ path: 'unused' })).toThrow(
    expect.objectContaining({ source: 'logging.file', code: 'FILE_SINK_UNAVAILABLE' })
  )
  expect(() =>
    filePlugin({
      path: 'unused',
      writer: { append: async () => undefined },
      rotate: { maxEntries: 1 }
    })
  ).toThrow(expect.objectContaining({ source: 'logging.file', code: 'INVALID_OPTION' }))
}
it('rejects missing browser writers and unsupported rotation at construction', writerAdmission)

/** Deno's native writer exposes only the append-capable surface used by this package. */
class DenoFiles {
  /** A real Deno version marker takes precedence over Node compatibility globals. */
  readonly version = { deno: '2.0.0' }
  /** Native calls retain path, exact text and append options. */
  readonly calls: Array<[string, string, { append: boolean }]> = []
  /** The native capability records its own receiver without importing Node filesystem modules. */
  async writeTextFile(path: string, text: string, options: { append: boolean }): Promise<void> {
    this.calls.push([path, text, options])
  }
}

/** Capture the native default while the Deno marker exists, then restore the real test host. */
function denoOutput(deno: DenoFiles): ReturnType<typeof filePlugin> {
  vi.stubGlobal('Deno', deno)
  try {
    return filePlugin({ path: 'deno.ndjson' })
  } finally {
    vi.unstubAllGlobals()
  }
}

/**
 * Default Deno delivery uses writeTextFile append instead of Node compatibility or overwrite
 * writes.
 */
async function nativeDeno(): Promise<void> {
  /** The native mock is borrowed by the production writer selected at creation. */
  const deno = new DenoFiles()
  /** The real Node globals are restored before any asynchronous host work runs. */
  const host = createLogHost({ plugins: [denoOutput(deno)] })
  host.log('info', 'deno')
  await host.flush()
  expect(deno.calls).toHaveLength(1)
  expect(deno.calls[0][0]).toBe('deno.ndjson')
  expect(JSON.parse(deno.calls[0][1]).message).toBe('deno')
  expect(deno.calls[0][2]).toEqual({ append: true })
  await host.shutdown('manual')
}
it('uses native Deno writeTextFile with append true', nativeDeno)
