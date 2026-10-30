import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { limitsFeature } from '@migaia/rpc-host/plugins/limits'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from '../../../rpc-host/test/host/core-fixture.ts'

describe('stream replay custody through public endpoint behavior', () => {
  it.each([false, true])(
    'disconnect cleans the pending iterator and reports cleanup failure: authenticated=%s',
    async (authenticated) => {
      /** This original physical pair lends the actual four-stage codec to the real Host owners. */
      const source = coreMemoryServer('server', 'server', 'memory', {}, [], {
        create: () => new RpcJsonCarrierCodec(),
        nativeBinary: false
      })
      /** Original iterator cleanup failures remain exact objects on the genuine Host report path. */
      const failures: unknown[] = []
      const server = await createRpcHost({
        ...source.options,
        plugins: [
          ...(authenticated
            ? [
                rpcFeaturesPlugin({
                  features: {
                    auth: authFeature({ sign: (value) => value, verify: (value) => value })
                  }
                })
              ]
            : []),
          source.transport
        ],
        report: (error) => failures.push(error)
      })
      /** The original native error must survive producer cleanup reporting unchanged. */
      const cause = new Error('fixture iterator return failure')
      /** Held pulls and cleanup retain their independent original lifetimes. */
      let release!: () => void
      /** Count actual pending pulls before physical EOF. */
      let pulls = 0
      /** Count iterator cleanup separately from the unresolved pull. */
      let returns = 0
      const held = new Promise<IteratorResult<never>>((resolve) => {
        release = () => resolve({ done: true, value: undefined })
      })
      server.provide({
        held: (_params, context) => {
          expect(context.signal.aborted).toBe(false)
          expect(context.success('admitted')).toMatchObject({ ok: true, data: 'admitted' })
          /** Explicit receiver methods preserve the original held pull and rejecting return. */
          const iterator: AsyncIterableIterator<never> = {
            [Symbol.asyncIterator]() {
              return this
            },
            next() {
              pulls += 1
              return held
            },
            return() {
              returns += 1
              return Promise.reject(cause)
            }
          }
          return iterator
        }
      })
      /** Initial accepted directories include the provider before its first public stream call. */
      const client = await source.connect('client', {
        plugins: authenticated
          ? [
              rpcFeaturesPlugin({
                features: {
                  auth: authFeature({ sign: (value) => value, verify: (value) => value })
                }
              })
            ]
          : []
      })
      try {
        const iterator = client.host.memory.stream('held', null) as AsyncIterableIterator<never>
        const pending = iterator.next().catch((error: unknown) => error)
        await vi.waitFor(() => expect(pulls).toBe(1))
        await client.pair[0].close()
        const failure = await pending
        expect(failure).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
        await expect(iterator.next()).rejects.toBe(failure)
        await vi.waitFor(() => expect(returns).toBe(1))
        await vi.waitFor(() => expect(failures.some((error) => error === cause)).toBe(true))
        release()
        await Promise.resolve()
        expect(returns).toBe(1)
      } finally {
        release()
        await client.host.close()
        await server.close()
      }
    }
  )

  it('protected stream replay capacity rejects a second identity before provider entry', async () => {
    /** Signed Auth owns the request-ID replay capacity for this original physical source. */
    const source = coreMemoryServer('server', 'server', 'memory', {}, [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    /** Borrow Auth's real refusal channel without replacing replay capacity with concurrency. */
    const notices: IRpcProviderRejection[] = []
    const server = await createRpcHost({
      ...source.options,
      plugins: [
        rpcFeaturesPlugin({
          features: {
            auth: authFeature({
              sign: (value) => value,
              verify: (value) => value,
              retain: 310_000,
              maxReplayEntriesPerPeer: 1,
              onRejected: (notice) => {
                notices.push(notice)
              }
            }),
            limits: limitsFeature()
          }
        }),
        source.transport
      ]
    })
    /** Each original active pull retains its iterator until explicit cleanup. */
    let release!: () => void
    /** Count true provider entry independently of physical reception. */
    let starts = 0
    /** A second provider entry is a decisive admission failure, not a timeout guess. */
    let secondEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      secondEntered = resolve
    })
    const held = new Promise<IteratorResult<never>>((resolve) => {
      release = () => resolve({ done: true, value: undefined })
    })
    server.provide({
      held: () => {
        starts += 1
        if (starts === 2) secondEntered()
        const iterator: AsyncIterableIterator<never> = {
          [Symbol.asyncIterator]() {
            return this
          },
          next: () => held,
          return: async () => ({ done: true as const, value: undefined })
        }
        return iterator
      }
    })
    /** Establish the original held method in the initial directory before testing replay capacity. */
    const client = await source.connect('client', {
      plugins: [
        rpcFeaturesPlugin({
          features: { auth: authFeature({ sign: (value) => value, verify: (value) => value }) }
        })
      ]
    })
    /** Cleanup always joins both original consumer promises, including the known failed admission. */
    const pending: Promise<unknown>[] = []
    try {
      const first = client.host.memory.stream('held', 'first') as AsyncIterableIterator<never>
      pending.push(first.next().catch((error: unknown) => error))
      await vi.waitFor(() => expect(starts).toBe(1))
      const rejected = client.host.memory.stream('held', 'second') as AsyncIterableIterator<never>
      const rejection = rejected.next()
      pending.push(rejection.catch((error: unknown) => error))
      /** Wait for either real refusal or real incorrect entry; never manufacture a policy error. */
      await Promise.race([
        entered,
        rejection.then(
          () => undefined,
          () => undefined
        )
      ])
      expect(starts).toBe(1)
      await expect(rejection).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ method: 'held', reason: 'replayLedgerFull' })
      expect(Object.isFrozen(notices[0])).toBe(true)
      expect(notices[0]!.verifiedPeerKey).not.toBe('')
      expect(notices[0]!.controllerKey).not.toBe('')
      await client.pair[0].close()
      await pending[0]
    } finally {
      release()
      await client.host.close()
      await server.close()
      await Promise.all(pending)
    }
  })
})
