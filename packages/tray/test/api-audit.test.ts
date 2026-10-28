import { getEventListeners } from 'node:events'
import { defineLoader, loadIntoHost } from '../src/loader/index.ts'
import { defineAdapter } from '../src/adapter/index.ts'
import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { createHost } from '../src/host/index.ts'

/** Real PluginHost configuration used by the managed ownership regressions. */
const execution = { mutationTimeoutMs: 500, pipelineDrainTimeoutMs: 500 }

describe('Tray API audit', () => {
  it('Tray-D01 rolls back only a claim acquired by this createHost call', async () => {
    /** Observe disposal through the actual installed plugin, without replacing an engine. */
    let disposals = 0
    /** This concrete host is intentionally offered twice through the supported factory option. */
    const concrete = defineHost<Record<string, never>, string>({ host: { execution } })
    /** The first managed facade keeps ownership after the duplicate is rejected. */
    const first = await createHost({
      create: () => concrete,
      plugins: [
        definePlugin({
          name: 'owner',
          install: () => ({ read: () => 7 }),
          dispose: () => {
            disposals++
          }
        })
      ],
      mutationAdmissionMs: 500,
      quiescenceMs: 0,
      shutdown: { mode: 'strict-drain' }
    })
    try {
      await expect(
        createHost({
          create: () => concrete,
          plugins: [],
          mutationAdmissionMs: 500,
          quiescenceMs: 0,
          shutdown: { mode: 'strict-drain' }
        })
      ).rejects.toMatchObject({ code: 'TRAY_INVALID_ENTRY' })
      expect(disposals).toBe(0)
      expect(first.extensions.read()).toBe(7)
    } finally {
      await first.dispose()
    }
    expect(disposals).toBe(1)
  })
})

/** Observes the native caller listener and the public loader context after successful commit. */
it('Tray-S01 ends admission cancellation while generation custody keeps the artifact', async () => {
  /** Actual managed Host owns the installed generation until explicit cleanup. */
  const host = await createHost({
    create: () => defineHost<Record<string, never>, string>({ host: { execution } }),
    plugins: [],
    mutationAdmissionMs: 500,
    quiescenceMs: 0,
    shutdown: { mode: 'strict-drain' }
  })
  /** Native caller cancellation must detach at transaction settlement. */
  const caller = new AbortController()
  /** Public loader context retained only to observe its post-commit signal. */
  let captured: AbortSignal | undefined
  /** Counts actual artifact release through the canonical custody owner. */
  let releases = 0
  try {
    /** Observe the committed result through the supported load entry. */
    const result = await loadIntoHost({
      host,
      source: 'source',
      signal: caller.signal,
      timeoutMs: 20,
      mutation: 'use',
      loader: {
        load: (_source, context) => {
          captured = context.signal
          return {
            value: 'artifact',
            release: {
              force: () => {
                releases++
              }
            }
          }
        }
      },
      adapter: { adapt: () => definePlugin({ name: 'artifact', install: () => ({}) }) }
    })
    expect(result.committed).toBe(true)
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0)
    await new Promise((resolve) => setTimeout(resolve, 40))
    caller.abort('after-return')
    expect(captured?.aborted).toBe(false)
    expect(releases).toBe(0)
    await host.unUse('artifact')
    expect(releases).toBe(1)
    expect(captured?.aborted).toBe(true)
  } finally {
    await host.dispose()
  }
})

it('Tray-S02 snapshots the validated loader getter once', () => {
  /** Counts sampling of the application method getter. */
  let reads = 0
  /** Counts invocation of the captured validated method. */
  let calls = 0
  /** Complete loader whose method getter is observed by the regression. */
  const loader = defineLoader({
    get load() {
      reads++
      return () => {
        calls++
        return { value: 'artifact', release: { force: () => {} } }
      }
    }
  })
  loader.load('source', {
    signal: new AbortController().signal,
    deadlineAt: undefined,
    report: () => {}
  })
  expect(reads).toBe(1)
  expect(calls).toBe(1)
})

it('Tray-S02 snapshots the validated adapter getter once', () => {
  /** Counts sampling of the application method getter. */
  let reads = 0
  /** Counts invocation of the captured validated method. */
  let calls = 0
  /** Complete adapter whose method getter is observed by the regression. */
  const adapter = defineAdapter({
    get adapt() {
      reads++
      return () => {
        calls++
        return definePlugin({ name: 'adapted', install: () => ({}) })
      }
    }
  })
  adapter.adapt('artifact', { signal: new AbortController().signal, deadlineAt: undefined })
  expect(reads).toBe(1)
  expect(calls).toBe(1)
})

it('Tray-D02 publishes one disposal Promise before disposing observers run', async () => {
  /** Actual managed Host owns the installed generation until explicit cleanup. */
  const host = await createHost({
    create: () => defineHost<Record<string, never>, string>({ host: { execution } }),
    plugins: [definePlugin({ name: 'work', install: () => ({}) })],
    mutationAdmissionMs: 500,
    quiescenceMs: 0,
    shutdown: { mode: 'strict-drain' }
  })
  /** Completion observed by a synchronous disposing listener. */
  let nested: ReturnType<typeof host.dispose> | undefined
  /** Keep the observation finite even before the reentrancy fix. */
  let entered = false
  host.on('disposing', () => {
    if (!entered) {
      entered = true
      nested = host.dispose()
    }
  })
  /** The initial call must publish the same completion to every observer. */
  const outer = host.dispose()
  expect(nested).toBe(outer)
  expect(await outer).toMatchObject({ cleanupComplete: true, cleanupErrors: [] })
  expect(host.dispose()).toBe(outer)
})

it('Tray-D03 keeps a frozen factory error reachable beside creation detail', async () => {
  /** Native failure identity must remain reachable without mutating a frozen value. */
  const original = Object.freeze(new TypeError('frozen factory'))
  /** Capture the actual public rejection without inspecting private state. */
  let failure: unknown
  try {
    await createHost({
      create: () => {
        throw original
      },
      plugins: [],
      mutationAdmissionMs: 500,
      quiescenceMs: 0,
      shutdown: { mode: 'strict-drain' }
    })
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({
    source: 'tray',
    code: 'TRAY_INVALID_ENTRY',
    cause: original,
    detail: { phase: 'factory', cleanupComplete: true, cleanupErrors: [] }
  })
  expect((failure as Error).cause).toBe(original)
  expect(original.stack).toContain('frozen factory')
})
