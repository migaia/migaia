import { expect, it, vi } from 'vitest'
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin, prettyFeature } from '../src/index.ts'

import { MemoryConsole, MemoryStdout } from './fixtures.ts'

/** Log severity routing, silent completion entries and raw output remain independently observable. */
async function consoleDelivery(): Promise<void> {
  /** The fixture captures original native argument lists. */
  const console = new MemoryConsole()
  /** The fixture captures exact raw output. */
  const stdout = new MemoryStdout()
  /** Pretty formatting is selected once at host scope. */
  const host = createLogHost({
    plugins: [levelPlugin(), consolePlugin({ console, stdout })],
    features: [prettyFeature({ color: 'never', timestamp: false })]
  })
  host.info('ordinary')
  host.warn('warning')
  host.error('error')
  host.dispatchRaw({ tag: 'info', message: 'silent', data: { silent: true } })
  expect(console.logs).toEqual([])
  await host.flush()
  expect(console.logs).toHaveLength(1)
  expect(console.warnings).toHaveLength(1)
  expect(console.errors).toHaveLength(1)
  host.raw('x')
  expect(stdout.writes).toEqual(['x'])
  /** Both direct raw failure and asynchronous console failure enter the same failure channel. */
  const failures: unknown[] = []
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  stdout.failure = new Error('raw failure')
  expect(() => host.raw('bad')).not.toThrow()
  console.failure = new Error('console failure')
  expect(() => host.info('bad')).not.toThrow()
  await host.flush()
  expect(failures).toEqual([stdout.failure, console.failure])
  await host.shutdown('manual')
}
it('routes native console entries, skips silent entries and contains raw failures', consoleDelivery)

/** Capture a recognized process without stdout, restoring globals before the host starts work. */
function outputWithoutStdout(console: MemoryConsole): ReturnType<typeof consolePlugin> {
  vi.stubGlobal('process', { versions: { node: process.versions.node }, env: {} })
  try {
    return consolePlugin({ console })
  } finally {
    vi.unstubAllGlobals()
  }
}

/** Absence of stdout keeps the console plugin's raw fallback on the borrowed console object. */
async function rawFallback(): Promise<void> {
  /** The console captures raw fallback without any real terminal write. */
  const console = new MemoryConsole()
  /** Only factory capability selection sees the process-without-stdout fixture. */
  const host = createLogHost({ plugins: [outputWithoutStdout(console)] })
  host.raw('fallback')
  expect(console.logs).toEqual([['fallback']])
  await host.shutdown('manual')
}
it('falls back to the borrowed console when raw stdout is unavailable', rawFallback)
