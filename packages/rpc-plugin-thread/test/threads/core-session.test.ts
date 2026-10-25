import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { readRpcLaunchFacts, type IRpcLaunchFacts } from '@migaia/rpc-host/sdk'
import { createUnitBudget, type ILaunchContext } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { expect, it } from 'vitest'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/node-launcher.js'

/** The existing real Worker fixture now uses the sole public Host/transport protocol path. */
const entry = new URL('./fixtures/short-spawn-worker.mjs', import.meta.url)

it('connects real native spawn/parent Sessions and retains exact launcher context and parent facts', async () => {
  /** This native source deliberately forwards through a caller-owned launcher before acquisition. */
  const native = createNodeThreadLauncher()
  /** Only real execution attempts contribute observations; no fake carrier or Session is used. */
  const attempts: { context: ILaunchContext; facts?: IRpcLaunchFacts; unit: INodeThreadHandle }[] =
    []
  /** Native failures remain visible to the actual source and Host reporter. */
  const report = (error: unknown): void => {
    throw error
  }
  /** One borrowed budget is released by the original supervisor only after actual native exit. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler: systemScheduler })
  /** An explicit real source preserves original launcher, scheduler, budget and supervision. */
  const host = await createRpcHost({
    self: { name: 'parent', instanceId: 'actual-thread-parent' },
    report,
    plugins: [
      threadPlugin({
        namespace: 'native',
        name: 'worker',
        spawn: {
          spec: { entry: entry.href, name: 'worker' },
          budget,
          scheduler: systemScheduler,
          report,
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler, report }),
          launcher: {
            capabilities: native.capabilities,
            async launch(spec, context) {
              /**
               * The actual native launcher reads this same original object through the SDK
               * metadata.
               */
              const facts = readRpcLaunchFacts(context)
              /**
               * The exact custom context is passed unchanged into the genuine Worker constructor
               * path.
               */
              const unit = await native.launch(spec, context)
              attempts.push({ context, facts, unit })
              return unit
            }
          }
        }
      })
    ]
  })
  try {
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.facts?.parent).toEqual({
      name: 'parent',
      instanceId: 'actual-thread-parent'
    })
    expect(readRpcLaunchFacts(attempts[0]!.context)).toBeUndefined()
    expect(await host.native.send('worker', 'child')).toBe(true)
    expect(await host.native.send('worker', 'double', 21)).toBe(42)
    expect(await host.native.members.get('worker')).toMatchObject({
      identity: { name: 'worker', instanceId: attempts[0]!.unit.identity.fingerprint },
      kind: 'spawn',
      direction: 'spawned'
    })
  } finally {
    await host.close()
    await Promise.all(attempts.map((attempt) => attempt.unit.exited))
  }
})

it('preserves real native transfer backing, offset and borrowed parent cleanup on the new protocol', async () => {
  /** Shorthand still acquires a genuine native Worker through the same launcher and budget defaults. */
  const host = await createRpcHost({
    plugins: [threadPlugin({ name: 'binary-worker', spawn: { entry, name: 'binary-worker' } })]
  })
  /** A nonzero view offset proves transfer uses the original complete backing. */
  const backing = new ArrayBuffer(16)
  /** Visible bytes remain separate from the prefix and suffix retained by the native backing. */
  const value = new Uint8Array(backing, 4, 3)
  value.set([7, 8, 9])
  try {
    /** Public options carry the exact backing to the actual Worker.postMessage transfer list. */
    const result = await host.thread.send('binary-worker', 'echo', value, { transfer: [backing] })
    expect(backing.byteLength).toBe(0)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result as Uint8Array)).toEqual([7, 8, 9])
    expect((result as Uint8Array).byteOffset).toBe(4)
    expect((result as Uint8Array).buffer.byteLength).toBe(16)
  } finally {
    await host.close()
  }
})

it('rejects missing, duplicate and main-thread parent sources before native acquisition', async () => {
  expect(await isThreadChild()).toBe(false)
  for (const options of [{}, { spawn: entry, connectToParent: true }, { connectToParent: true }])
    expect(() => threadPlugin(options as Parameters<typeof threadPlugin>[0])).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
})
