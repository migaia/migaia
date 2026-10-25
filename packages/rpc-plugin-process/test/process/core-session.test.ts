import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'
import { readRpcLaunchFacts, type IRpcLaunchFacts } from '@migaia/rpc-host/sdk'
import { createUnitBudget, type ILaunchContext } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  createNodeProcessLauncher,
  type INodeProcessHandle
} from '../../src/process/adapters/node-child-process.js'

/** Native Node executes TypeScript directly; the fixture has no source-relative JS import. */
const entry = new URL('./fixtures/core-session-child.ts', import.meta.url)

it('opens actual full spawn/parent Sessions with exact launch context, native facts and reaped exit', async () => {
  /** The original launcher, budget and native exited receipts remain the actual execution owners. */
  const native = createNodeProcessLauncher()
  /** Only real native launch attempts produce observations. */
  const attempts: { context: ILaunchContext; facts?: IRpcLaunchFacts; unit: INodeProcessHandle }[] =
    []
  /** Expected native capability notices and secondary cleanup remain observable. */
  const reports: unknown[] = []
  /** The source's private launch credential is unrelated to any diagnostic identity. */
  const token = 'actual-process-launch-token'
  /** The caller's budget is never replaced by a new SDK supervision policy. */
  const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler: systemScheduler })
  /** Both directions use the sole public Host and actual transport namespace. */
  const host = await createRpcHost({
    self: { name: 'parent', instanceId: 'actual-process-parent' },
    provide: { double: (value: number) => value * 2 },
    report: (error) => reports.push(error),
    plugins: [
      processPlugin({
        name: 'worker',
        namespace: 'native',
        spawn: {
          kind: 'spawn',
          channelKind: 'byte',
          token,
          rawChannel: async (unit) => (unit as INodeProcessHandle).channel!,
          supervision: {
            id: 'caller-supervisor-id',
            budget,
            scheduler: systemScheduler,
            isolation: 'best-effort',
            report: (error) => reports.push(error),
            spec: {
              command: process.execPath,
              args: [fileURLToPath(entry)],
              env: { inherit: ['PATH'], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
              bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
            },
            launcher: {
              capabilities: native.capabilities,
              async launch(spec, context) {
                /** A custom launcher sees and passes the same original supervisor context. */
                const facts = readRpcLaunchFacts(context)
                /** Native child acquisition consumes those actual facts without a facade. */
                const unit = await native.launch(spec, context)
                attempts.push({ context, facts, unit })
                return unit
              }
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
      instanceId: 'actual-process-parent'
    })
    expect(attempts[0]!.facts?.childName).toBe('worker')
    expect(attempts[0]!.facts?.generation.providerId).not.toBe('caller-supervisor-id')
    expect(readRpcLaunchFacts(attempts[0]!.context)).toBeUndefined()
    expect(await host.native.send('worker', 'child')).toBe(true)
    expect(await host.native.send('worker', 'echo', 21)).toBe(21)
    expect(await host.native.send('worker', 'reverse', 21)).toBe(42)
    /** The original native stream's lifecycle remains independent from the scalar call table. */
    const values: unknown[] = []
    for await (const value of host.native.stream('sequence') as AsyncIterableIterator<unknown>)
      values.push(value)
    expect(values).toEqual([1, 2])
    expect(await host.native.members.get('worker')).toMatchObject({
      identity: { name: 'worker', instanceId: attempts[0]!.unit.identity.fingerprint },
      kind: 'spawn'
    })
    expect(await host.native.send('worker', 'identity')).toMatchObject({
      self: { name: 'worker', instanceId: attempts[0]!.unit.identity.fingerprint }
    })
  } finally {
    await host.close()
    await Promise.all(attempts.map((attempt) => attempt.unit.exited))
  }
  expect(() => process.kill(attempts[0]!.unit.identity.pid!, 0)).toThrow()
}, 10_000)

it('preserves actual short spawn inline binary and refuses explicit native transfer without detaching', async () => {
  /** Shorthand still launches a genuine process and opens its real bootstrap/stdin source. */
  const host = await createRpcHost({
    plugins: [processPlugin({ spawn: entry, report: () => undefined })],
    report: () => undefined
  })
  /**
   * Inline binary preserves the original visible bytes and zero-prefix offset, without a native
   * backing.
   */
  const backing = new ArrayBuffer(16)
  /** The visible view has a distinct prefix and suffix in its backing. */
  const value = new Uint8Array(backing, 4, 3)
  value.set([7, 8, 9])
  try {
    /** Inline codec does not transfer or detach process memory. */
    const result = await host.process.request('echo', value)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result as Uint8Array)).toEqual([7, 8, 9])
    expect((result as Uint8Array).byteOffset).toBe(4)
    expect((result as Uint8Array).buffer.byteLength).toBe(7)
    await expect(
      host.process.request('echo', value, { transfer: [backing] })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(backing.byteLength).toBe(16)
    /** Own presence rejects even undefined, before reading native ownership or business getters. */
    const observed = { transfer: 0, payload: 0 }
    /** This accessor would be observable if native options admission occurred after payload capture. */
    const payload = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        observed.payload++
        return 1
      }
    })
    /** The original own-property check must not execute this nonenumerable ownership getter. */
    const ownership = Object.defineProperty({}, 'transfer', {
      get: () => {
        observed.transfer++
        return [backing]
      }
    })
    await expect(
      host.process.request('echo', payload, { transfer: undefined })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(host.process.request('echo', payload, ownership)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    expect(observed).toEqual({ transfer: 0, payload: 0 })
  } finally {
    await host.close()
  }
}, 10_000)

it('retains exact source exclusivity and connect.target decorators before native opening', () => {
  expect(isProcessChild()).toBe(false)
  for (const options of [
    {},
    { connectToParent: false },
    { connectToParent: true },
    { spawn: entry, connect: { target: 'unused' } }
  ])
    expect(() => processPlugin(options as Parameters<typeof processPlugin>[0])).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  expect(() => processPlugin({ spawn: entry, connect: { timeoutMs: 1000 } })).not.toThrow()
  expect(() => processPlugin({ connect: { target: 'unused', timeoutMs: 1000 } })).not.toThrow()
})
