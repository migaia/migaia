import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import type { ILogEntry, ILogPluginCore } from '@migaia/log-host/plugin'
import { reasoningPlugin, ReasoningPhase } from '../src/index.ts'
import { consolePlugin } from '../../log-plugin-console/src/index.ts'
import { httpPlugin } from '../../log-plugin-http/src/index.ts'
import { filePlugin } from '../../log-plugin-file/src/index.ts'

/** A real downstream sink receives completed audit entries independently of token writes. */
class EntryCapture {
  /** A non-output plugin observes the exact ordinary entries emitted by the reasoning owner. */
  readonly name = 'reasoning-capture'
  /** Finished phases are retained with their native entry containers. */
  readonly entries: ILogEntry[] = []
  /** Register the observer during canonical installation. */
  install(core: ILogPluginCore): Record<string, never> {
    core.useSink((entry) => this.receive(entry))
    return {}
  }
  /** Retain the host-created entry without projection. */
  receive(entry: ILogEntry): void {
    this.entries.push(entry)
  }
}

/** Tokens stream without ANSI while a complete silent entry remains available for audit delivery. */
async function reasoningDelivery(): Promise<void> {
  /** Token writes remain one-off text fragments in their original call order. */
  const writes: string[] = []
  /** The downstream observer is independent from the stream writer. */
  const capture = new EntryCapture()
  /** Explicit write injection avoids process-global writer mutations. */
  const host = createLogHost({
    plugins: [
      reasoningPlugin({
        write: (text) => {
          writes.push(text)
        }
      }),
      capture
    ]
  })
  host.startThinking('T')
  host.thinking('a')
  host.thinking('b')
  host.endThinking()
  expect(writes).toEqual(['T\n\n', 'a', 'b', '\n\n'])
  await host.flush()
  expect(capture.entries).toHaveLength(1)
  expect(capture.entries[0]).toMatchObject({
    tag: 'thinking',
    message: 'ab',
    data: { reasoningPhase: ReasoningPhase.thinking, silent: true }
  })
  host.response('c')
  host.endResponse()
  await host.flush()
  expect(capture.entries[1]).toMatchObject({
    tag: 'response',
    message: 'c',
    data: { reasoningPhase: ReasoningPhase.responding, silent: true }
  })
  await host.shutdown('manual')
}
it('streams original text and publishes one complete silent entry per phase', reasoningDelivery)

/** Writer failures are reported without throwing through reasoning's business methods. */
async function writerFailure(): Promise<void> {
  /** The original Error is the identity asserted at the failure boundary. */
  const primary = new Error('reasoning writer failure')
  /** Every report is retained separately so duplicate observation cannot pass. */
  const failures: unknown[] = []
  /** A throwing writer stays inside the plugin's failure boundary. */
  const host = createLogHost({
    plugins: [
      reasoningPlugin({
        write: () => {
          throw primary
        }
      })
    ]
  })
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  expect(() => host.startThinking('T')).not.toThrow()
  expect(failures).toEqual([primary])
  await host.shutdown('manual')
}
it('contains the original synchronous token-writer failure', writerFailure)

/** A phase switch publishes the unfinished prior phase without implicitly finishing the new one. */
async function phaseSwitch(): Promise<void> {
  /** Ordinary entries expose completion independently of token output. */
  const capture = new EntryCapture()
  /** Labels are streamed into memory to keep the fixture independent of the real terminal. */
  const writes: string[] = []
  /** The real public methods own the phase transition. */
  const logger = createLogHost({
    plugins: [
      reasoningPlugin({
        write: (text) => {
          writes.push(text)
        }
      }),
      capture
    ]
  })
  logger.startThinking()
  logger.thinking('unfinished thinking')
  logger.response('answer')
  await logger.flush()
  expect(capture.entries.map(entryTag)).toEqual(['thinking'])
  expect(capture.entries[0]?.message).toBe('unfinished thinking')
  expect(writes).toEqual(['Thinking...\n\n', 'unfinished thinking', 'answer'])
  await logger.shutdown('manual')
  expect(capture.entries).toHaveLength(1)
}

/** Select the unchanged completed-entry tag for the legacy switch assertion. */
function entryTag(entry: ILogEntry): string {
  return entry.tag
}
it('flushes an unfinished reasoning phase before switching phase', phaseSwitch)

/** Deferred token writes and completed entries share the real host's tracked asynchronous work. */
async function asynchronousOutput(): Promise<void> {
  /** The original writer assertion remains separate from entry delivery. */
  const write = vi.fn()
  /** This captures complete phase messages from a real non-output plugin. */
  const capture = new EntryCapture()
  /** Explicit asyncOutput defers streaming even though its default remains synchronous. */
  const logger = createLogHost({
    plugins: [reasoningPlugin({ write, asyncOutput: true }), capture]
  })
  logger.response('answer')
  logger.endResponse()
  expect(write).not.toHaveBeenCalled()
  expect(capture.entries).toEqual([])
  await logger.flush()
  expect(write).toHaveBeenCalledWith('answer')
  expect(capture.entries.map(entryMessage)).toEqual(['answer'])
  await logger.shutdown('manual')
}

/** Select the complete business text without observing any plugin-private state. */
function entryMessage(entry: ILogEntry): string {
  return entry.message
}
it('applies reasoning asyncOutput to raw and completed entry output', asynchronousOutput)

/** Empty and unfinished buffers preserve explicit completion/disposal semantics. */
async function emptyAndUnfinished(): Promise<void> {
  /** Completed entries must remain absent for every empty/unfinished path. */
  const capture = new EntryCapture()
  /** Explicit labels also prove the configured response heading remains optional. */
  const writes: string[] = []
  /** The plugin owns only phase state, not a host raw capability. */
  const host = createLogHost({
    plugins: [
      reasoningPlugin({
        write: (text) => {
          writes.push(text)
        },
        labels: { thinking: 'Plan', response: 'Answer' }
      }),
      capture
    ]
  })
  expect(host).not.toHaveProperty('raw')
  host.startThinking()
  host.endThinking()
  host.startResponse()
  host.endResponse()
  await host.flush()
  expect(capture.entries).toEqual([])
  expect(writes).toEqual(['Plan\n\n', '\n\n', 'Answer\n\n', '\n'])
  host.thinking('unfinished')
  await host.shutdown('manual')
  expect(capture.entries).toEqual([])
}
it('does not publish empty phases or unfinished text during disposal', emptyAndUnfinished)

/** Completed silent entries still reach HTTP/file while console skips duplicate display. */
async function allOutputs(): Promise<void> {
  /** The raw stream keeps its exact fragment ordering. */
  const writes: string[] = []
  /** Every structured output records its independent wire/file observation. */
  const bodies: string[] = []
  /** File output receives ordinary host-formatted JSON text. */
  const lines: string[] = []
  /** Silent entries must not produce any console call. */
  const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  /** All real production plugins share one host and its canonical output pipeline. */
  const host = createLogHost({
    plugins: [
      reasoningPlugin({
        write: (text) => {
          writes.push(text)
        }
      }),
      consolePlugin({ console }),
      httpPlugin({
        url: 'memory-only',
        fetcher: async (_url, init) => {
          bodies.push(init.body)
          return new Response(null, { status: 200 })
        }
      }),
      filePlugin({
        path: 'memory.ndjson',
        writer: {
          async append(_path, text) {
            lines.push(text)
          }
        }
      })
    ]
  })
  host.startThinking('T')
  host.thinking('a')
  host.thinking('b')
  host.endThinking()
  await host.flush()
  expect(writes).toEqual(['T\n\n', 'a', 'b', '\n\n'])
  expect(bodies).toHaveLength(1)
  expect(lines).toHaveLength(1)
  expect(JSON.parse(bodies[0]).entries[0]).toMatchObject({
    tag: 'thinking',
    message: 'ab',
    data: { reasoningPhase: 'thinking', silent: true }
  })
  expect(JSON.parse(lines[0])).toMatchObject({
    tag: 'thinking',
    message: 'ab',
    data: { reasoningPhase: 'thinking', silent: true }
  })
  expect(console.log).not.toHaveBeenCalled()
  expect(console.warn).not.toHaveBeenCalled()
  expect(console.error).not.toHaveBeenCalled()
  await host.shutdown('manual')
}
it('sends complete silent phases to HTTP/file without repeating console output', allOutputs)

/** Node and Bun defaults borrow native stdout without adding ANSI or a console-package dependency. */
async function defaultStdout(runtime: 'node' | 'bun'): Promise<void> {
  if (runtime === 'bun') vi.stubGlobal('Bun', {})
  /** Observe the borrowed original output capability without changing process identity. */
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  /** No writer is injected, exercising runtime default selection. */
  const host = createLogHost({ plugins: [reasoningPlugin()] })
  try {
    host.response(runtime)
    host.endResponse()
    await host.flush()
    expect(write).toHaveBeenCalledWith(runtime)
    expect(write).toHaveBeenCalledWith('\n')
  } finally {
    await host.shutdown('manual')
    write.mockRestore()
    vi.unstubAllGlobals()
  }
}
it.each(['node', 'bun'] as const)('borrows the %s default stdout writer', defaultStdout)

/** Create an ordinary host whose reasoning installation cannot find a server stdout capability. */
function hostWithoutStdout() {
  vi.stubGlobal('process', { env: {}, versions: {} })
  try {
    return createLogHost({ plugins: [reasoningPlugin()] })
  } finally {
    vi.unstubAllGlobals()
  }
}

/** A stdout-free runtime preserves the former default writer's console fallback. */
async function fallbackConsole(): Promise<void> {
  /** Only the default writer's original raw text is observed. */
  const log = vi.spyOn(globalThis.console, 'log').mockImplementation(() => undefined)
  /** All globals are restored before the first token is written. */
  const host = hostWithoutStdout()
  try {
    host.response('fallback')
    host.endResponse()
    await host.flush()
    expect(log).toHaveBeenCalledWith('fallback')
    expect(log).toHaveBeenCalledWith('\n')
  } finally {
    await host.shutdown('manual')
    log.mockRestore()
  }
}
it('uses the original console fallback when no stdout exists', fallbackConsole)
