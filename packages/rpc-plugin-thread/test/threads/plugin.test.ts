import { describe, expect, it, vi } from 'vitest'
import { Worker, threadId } from 'node:worker_threads'
import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcHost } from '@migaia/rpc-host'
import { pool } from '../../../rpc-plugin-pool/dist/index.js'
import * as thread from '@migaia/rpc-plugin-thread'
import * as node from '../../dist/threads/node-launcher.js'

/** Runtime lookup makes the first preimplementation failure exercise the actual built root. */
const threadPlugin = thread.threadPlugin
/** Every new business call runs through a genuine independent native Worker host. */
const child = new URL('./fixtures/host-plugin-child.mts', import.meta.url)

/** Collect only the original stream, without wrapping or replacing its lifetime. */
async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of stream) values.push(value)
  return values
}

describe('native thread transport plugin', () => {
  it('uses one real Worker for bidirectional calls and streams with native child identity and termination', async () => {
    expect(typeof threadPlugin).toBe('function')
    expect(await thread.isThreadChild()).toBe(false)
    const terminated = vi.spyOn(Worker.prototype, 'terminate')
    const host = await createRpcHost({
      plugins: [threadPlugin({ spawn: child })],
      provide: {
        parentEcho: (value: number) => value * 2,
        parentSequence: async function* () {
          yield 3
          yield 4
        }
      },
      report: () => undefined
    })
    try {
      expect(await host.thread.request('echo', 21)).toBe(21)
      expect(await host.thread.request('reverse', 21)).toBe(42)
      expect(await collect(host.thread.stream('sequence') as AsyncIterable<unknown>)).toEqual([
        1, 2
      ])
      expect(await collect(host.thread.stream('reverseStream') as AsyncIterable<unknown>)).toEqual([
        3, 4
      ])
      expect(await host.thread.request('identity')).toMatchObject({ pid: process.pid, child: true })
      expect(((await host.thread.request('identity')) as { threadId: number }).threadId).not.toBe(
        threadId
      )
    } finally {
      await host.close()
      expect(terminated).toHaveBeenCalledTimes(1)
      terminated.mockRestore()
    }
  }, 15_000)

  it('rejects all invalid sources synchronously with the original error and no Worker', () => {
    for (const options of [{}, { spawn: true, connectToParent: true }, { connectToParent: true }]) {
      expect(() => threadPlugin(options as Parameters<typeof threadPlugin>[0])).toThrow(
        expect.objectContaining({
          name: 'RpcError',
          source: 'rpc.endpoint',
          code: 'INVALID_CONFIG',
          message: 'Runtime Peer requires exactly one connection source'
        })
      )
    }
  })

  it('opens the same cold spawn definition as three independently owned native Workers', async () => {
    const host = await createRpcHost({
      plugins: [threadPlugin({ spawn: child, features: [pool({ size: 3 })] })],
      report: () => undefined
    })
    try {
      const ids = await Promise.all(
        [0, 1, 2].map(
          async () => ((await host.thread.request('identity')) as { threadId: number }).threadId
        )
      )
      expect(new Set(ids).size).toBe(3)
      /** BC7 keeps exact native isolation through the actual member controls. */
      const first = (await host.thread.members.list()).connections[0]!.identity
      if (!('instanceId' in first)) return expect.unreachable()
      await host.thread.members.stop(first.instanceId)
      expect(await host.thread.request('echo', 42)).toBe(42)
    } finally {
      await host.close()
    }
  }, 15_000)

  it('installs the same native plugin on an ordinary Host and keeps unrelated feature ownership', async () => {
    const local = definePlugin({
      name: 'math',
      features: { value: defineFeature(() => ({ double: (value: number) => value * 2 })) },
      install: () => ({})
    })
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const [mathHandle] = await host.use(local)
    await host.use(threadPlugin({ name: 'native', spawn: child, expose: ['math.double'] }))
    try {
      const outlet = Reflect.get(host, 'thread') as {
        send(name: string, method: string, payload?: unknown): Promise<unknown>
      }
      expect(await outlet.send('native', 'exposed', 21)).toBe(42)
      expect(await host.unUse('native')).toMatchObject({ ok: true })
      expect(mathHandle.getFeature('value').double(3)).toBe(6)
    } finally {
      await host.dispose()
    }
  }, 15_000)

  it('keeps the canonical native adapter behind the cold public root', async () => {
    expect(Object.keys(thread).toSorted()).toEqual(
      ['RPC_THREAD_ERROR_SOURCE', 'RpcThreadErrorCode', 'isThreadChild', 'threadPlugin'].toSorted()
    )
    expect(Object.keys(node).toSorted()).toEqual(
      ['createNodeThreadLauncher', 'createNodeThreadChannelFactory'].toSorted()
    )
    for (const [launcher, factory, strength] of [
      [
        node.createNodeThreadLauncher(),
        node.createNodeThreadChannelFactory({ scheduler: systemScheduler }),
        'enforced'
      ]
    ] as const) {
      expect(launcher.capabilities).toEqual({
        termination: strength,
        'exit-observation': strength,
        'heap-limit': strength
      })
      const handle = await launcher.launch(
        { entry: new URL('./fixtures/adapter-idle.mts', import.meta.url).href },
        { signal: new AbortController().signal }
      )
      try {
        expect(handle.identity.threadId).not.toBe(threadId)
        const channel = await factory.open(handle, new AbortController().signal)
        await channel.close()
      } finally {
        handle.terminate()
        await handle.exited
      }
    }
  }, 15_000)
})
