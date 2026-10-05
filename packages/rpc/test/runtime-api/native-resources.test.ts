import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPlugin } from '../../src/threads/index.js'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { RuntimeQueryReason } from '../../src/remote/runtime-api/constants.js'
import { runtimeTestHost } from './fixture.js'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createNodeThreadLauncher } from '../../src/threads/adapters/node.js'
import { nativeWorkerFor } from '../threads/fixture.js'

it('[A44] each actual child PID supplies current RSS and cumulative user/system CPU', async () => {
  /** Both processes remain alive while local cold sampling reads their distinct native PIDs. */
  const launcher = createNodeProcessLauncher()
  /** Different allocations make copying one aggregate parent sample observable. */
  const handles = await Promise.all(
    [8, 48].map((mb) =>
      launcher.launch(
        {
          command: process.execPath,
          args: [
            '-e',
            `globalThis.memory = new Uint8Array(${mb} * 1024 * 1024).fill(7); process.stderr.write('ready'); setInterval(() => {}, 1000)`
          ],
          env: { inherit: [], set: {} },
          stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }
        },
        { signal: new AbortController().signal, output: () => undefined }
      )
    )
  )
  try {
    expect(handles[0]!.identity.pid).not.toBe(handles[1]!.identity.pid)
    for (const handle of handles) {
      expect(typeof handle.sampleUsage, '[A44] native owner has a local sampler').toBe('function')
      /** The values are real readings, so legitimate zero cumulative CPU remains valid. */
      const sample = await handle.sampleUsage!()
      expect(sample.rssBytes).toBeGreaterThan(0)
      expect(sample.cpuUserMicros).toBeGreaterThanOrEqual(0)
      expect(sample.cpuSystemMicros).toBeGreaterThanOrEqual(0)
      expect(sample.cpuTimeMs).toBe((sample.cpuUserMicros! + sample.cpuSystemMicros!) / 1000)
    }
  } finally {
    for (const handle of handles) handle.terminate('force')
    await Promise.all(handles.map((handle) => handle.exited))
  }
})

it('[A45] a genuine Node Worker samples its isolate and native thread CPU without RSS', async () => {
  /** The existing Worker fixture owns its own isolate independently of the test process heap. */
  const entry = fileURLToPath(new URL('../threads/fixtures/lifecycle-worker.mjs', import.meta.url))
  /** Only the actual launcher and native Worker participate in sampling. */
  const handle = await createNodeThreadLauncher().launch(
    { entry },
    { signal: new AbortController().signal }
  )
  try {
    /** Native capability detection establishes which values this runtime can actually supply. */
    const native = nativeWorkerFor(handle)
    await new Promise<void>((resolve) => native.once('online', resolve))
    expect(typeof handle.sampleUsage, '[A45] isolate sampler belongs to the native handle').toBe(
      'function'
    )
    /** Querying is local; no application or hidden management message is sent. */
    const sample = await handle.sampleUsage!()
    expect('rssBytes' in sample).toBe(false)
    expect(sample.sharedPid).toBe(process.pid)
    if (typeof native.getHeapStatistics === 'function') {
      expect(sample.heapUsedBytes).toBeGreaterThan(0)
      expect(sample.heapTotalBytes).toBeGreaterThanOrEqual(sample.heapUsedBytes!)
    }
    if (typeof native.cpuUsage === 'function') {
      expect(sample.cpuUserMicros).toBeGreaterThanOrEqual(0)
      expect(sample.cpuSystemMicros).toBeGreaterThanOrEqual(0)
    }
  } finally {
    handle.terminate()
    await handle.exited
  }
})

it('[A44][A45] an asynchronous query retains its selected native generation across replacement', async () => {
  /** Sampling pauses only after the original native handle has supplied its own isolate values. */
  let sampled!: () => void
  /** The original query cannot settle until the fixture observes a real replacement. */
  const sampling = new Promise<void>((resolve) => {
    sampled = resolve
  })
  /** Releasing the old read never permits the query to select a new handle by name. */
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** Native calls are counted separately from query identity and supervisory generation. */
  let samples = 0
  const launcher = createNodeThreadLauncher()
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(
      createThreadPlugin({
        name: 'sampled',
        provide: { parent: { echo: () => 42 } },
        report: () => undefined,
        spawn: {
          spec: { entry: fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url)) },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (...args: Parameters<typeof launcher.launch>) => {
              const handle = await launcher.launch(...args)
              return {
                ...handle,
                sampleUsage: async () => {
                  samples += 1
                  const sample = await handle.sampleUsage!()
                  if (samples === 1) {
                    sampled()
                    await held
                  }
                  return sample
                }
              }
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          report: () => undefined
        }
      })
    )
    const oldId = readRuntimeOutletConnection(host.thread, 'sampled')!.instanceId
    const query = host.thread!.get('sampled')
    await sampling
    await host.thread!.kill('sampled')
    await host.thread!.restart('sampled')
    await vi.waitFor(() => {
      const connection = readRuntimeOutletConnection(host.thread, 'sampled')
      expect(connection).toBeTruthy()
      expect(connection!.instanceId).not.toBe(oldId)
    })
    release()
    const oldDetail = await query
    expect(oldDetail.identity).toMatchObject({ instanceId: oldId })
    expect(oldDetail.resources).toEqual({
      status: 'unavailable',
      reason: RuntimeQueryReason.retired
    })
    expect(samples, '[A45] a retired read never resamples its successor').toBe(1)
    const current = await host.thread!.get('sampled')
    expect(current.identity).not.toMatchObject({ instanceId: oldId })
    expect(current.resources).toMatchObject({ scope: 'thread' })
    expect(samples).toBe(2)
  } finally {
    release()
    await host.dispose()
  }
  expect(budget.inUse).toBe(0)
})
