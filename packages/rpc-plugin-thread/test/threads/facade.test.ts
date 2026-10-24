import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it } from 'vitest'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'
import { nativeFixture, workerEntry } from './fixture.js'
import {
  RpcRuntimeKind,
  RpcRuntimeMode,
  RpcRuntimeProfile,
  readRuntimeCarrier
} from '@migaia/rpc-contract/runtime'
import { readRpcBatchMembers } from '@migaia/rpc-contract/framing'

describe('thread Host facade', () => {
  it('Host forwards callWallTimeMs as the total request deadline', async () => {
    /** The clock is advanced only after a real Worker has received the logical call. */
    const scheduler = createManualScheduler()
    /** Host requests use the same remote deadline owner as Plugin requests. */
    const host = nativeFixture({
      scheduler,
      channelFactory: createNodeThreadChannelFactory({ scheduler }),
      spec: { entry: workerEntry, limits: { callWallTimeMs: 100 } }
    })
    try {
      /** Adoption creates the actual Worker-side plugin before its never-finishing request. */
      await host.host.use(host.plugin)
      const outlet = host.host.thread!

      /** Caller allowance is larger, so the facade's 100 ms cap must win. */
      const result = outlet
        .request('p', 'p.hold', undefined, { timeoutMs: 200 })
        .catch((error: unknown) => error)
      await expect
        .poll(
          () =>
            host.frames
              .flatMap(({ message }) => {
                /** Decode only the canonical physical carrier selector before batch grammar. */
                const frame = readRuntimeCarrier(message)?.frame ?? message
                return readRpcBatchMembers(frame) ?? [frame]
              })
              .some(
                (message) =>
                  message !== null &&
                  typeof message === 'object' &&
                  Reflect.get(message, 'profile') === RpcRuntimeProfile &&
                  Reflect.get(message, 'kind') === RpcRuntimeKind.call &&
                  Reflect.get(message, 'task')?.mode === RpcRuntimeMode.request &&
                  Reflect.get(message, 'task')?.method === 'p.hold'
              ),
          {
            timeout: 1000
          }
        )
        .toBe(true)
      scheduler.advance(100)
      /** Allow cancellation settlement without waiting for a wall-clock timeout. */
      let settled = false
      void result.then(() => {
        settled = true
      })
      for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
      expect(settled).toBe(true)
      expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(
        host.frames
          .flatMap(({ message }) => {
            /** Decode only the canonical physical carrier selector before batch grammar. */
            const frame = readRuntimeCarrier(message)?.frame ?? message
            return readRpcBatchMembers(frame) ?? [frame]
          })
          .filter(
            (message) =>
              message !== null &&
              typeof message === 'object' &&
              Reflect.get(message, 'profile') === RpcRuntimeProfile &&
              Reflect.get(message, 'kind') === RpcRuntimeKind.call &&
              Reflect.get(message, 'task')?.mode === RpcRuntimeMode.request &&
              Reflect.get(message, 'task')?.method === 'p.hold'
          )
      ).toHaveLength(1)
    } finally {
      await host.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })

  it('uses two independent Worker Hosts and closes only one connection', async () => {
    const first = nativeFixture()
    const second = nativeFixture()
    try {
      await first.host.use(first.plugin)
      await second.host.use(second.plugin)
      const left = first.host.thread!
      const right = second.host.thread!

      expect(await left.request('p', 'p.read', 'first')).toBe('first')
      expect(await right.request('p', 'p.read', 'second')).toBe('second')

      const frames = first.frames.length
      expect(() => left.request('p', 'unknown.read')).toThrow(
        expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' })
      )
      expect(first.frames).toHaveLength(frames)
      await first.close()
      expect(await right.request('p', 'p.read', 'still live')).toBe('still live')
      expect(first.handles[0]!.identity.fingerprint).not.toBe(
        second.handles[0]!.identity.fingerprint
      )
    } finally {
      await first.close()
      await second.close()
    }
  })
})
