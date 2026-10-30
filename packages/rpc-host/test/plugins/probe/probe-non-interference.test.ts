import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { batchFeature } from '@migaia/rpc-host/plugins/batch'
import {
  probe,
  defineProbe,
  RpcProbeOutcome,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'

import { RpcTimeoutError, RpcAbortError } from '@migaia/rpc-contract/errors'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { coreMemoryServer } from '../../host/core-fixture.ts'

/** Every original observer configuration drives the same real public business matrix. */
const probeModes = ['absent', 'recording', 'throw', 'reject', 'reentrant'] as const

/** The canonical public fixture's host type avoids a substitute request or Peer protocol. */
type IConnectedHost = Awaited<ReturnType<ReturnType<typeof coreMemoryServer>['connect']>>['host']

describe('public probe non-interference', () => {
  it.each(probeModes)(
    'preserves runtime results, business error chain, 64 calls and path state with %s probe',
    async (mode) => {
      /** The original native business graph remains distinct from an observer's own failure. */
      const original = new RangeError('probe isolation business failure')
      /** Observer failure must never replace a real call result or cancellation reason. */
      const sinkFailure = new Error('probe isolation sink failure')
      /** This real provider wait can outlive a caller timeout or abort until explicit cleanup. */
      const held = deferred<void>()
      /** Business records contain only real provider effects, never client Promise counts. */
      const business = { calls: [] as number[], active: 0, reports: [] as unknown[] }
      /** One callback-owned record keeps public reentry and observation facts together. */
      const observed: {
        client?: IConnectedHost
        nested?: Promise<unknown>
        count: number
        reports: unknown[]
      } = { count: 0, reports: [] }
      /** A genuine compiled handle is shared; each public Host installs its own native emitter. */
      const handle =
        mode === 'absent'
          ? undefined
          : defineProbe({
              stages: ['message', 'envelope', 'encoded', 'frame', 'protected'],
              onError: (error) => observed.reports.push(error),
              emit: (event: IRpcProbeEventView) => {
                observed.count += 1
                if (mode === 'throw') throw sinkFailure
                if (mode === 'reject') return Promise.reject(sinkFailure)
                if (
                  mode === 'reentrant' &&
                  event.outcome === RpcProbeOutcome.created &&
                  event.method === 'reenter' &&
                  observed.client &&
                  !observed.nested
                )
                  observed.nested = observed.client.memory.send('probe-server', 'echo', -1)
              }
            })
      /** Plain string frames let the actual optional batch owner retain the original 64-call path. */
      const listener = coreMemoryServer('probe-server', 'probe-server', 'memory', {}, [], {
        create: () => new RpcJsonCarrierCodec(),
        nativeBinary: false
      })
      /** Observation remains an optional native plugin, never a substituted emitter unit. */
      const selected = handle ? [probe(handle)] : []
      /** Public providers preserve the same scalar, failure, hold, notification and stream effects. */
      const server = await createRpcHost({
        ...listener.options,
        plugins: [
          rpcFeaturesPlugin({ features: { batch: batchFeature() } }),
          ...selected,
          listener.transport
        ],
        report: (error) => business.reports.push(error),
        provide: {
          reenter: () => 9,
          hold: async () => {
            business.active += 1
            try {
              await held.promise
              return 9
            } finally {
              business.active -= 1
            }
          },
          echo: (value: number) => {
            if (value >= 0) business.calls.push(value)
            return value
          },
          fail: () => {
            throw original
          },
          values: async function* () {
            yield 1
            yield 2
            yield 3
          }
        }
      })
      /** A separate genuine Host owns its native Session and caller completion. */
      const client = await listener.connect('probe-client', {
        plugins: [rpcFeaturesPlugin({ features: { batch: batchFeature() } }), ...selected],
        report: (error) => business.reports.push(error)
      })
      observed.client = client.host
      /** The spy retains the real carrier implementation and observes actual physical batching. */
      const sending = vi.spyOn(client.pair[1], 'write')
      try {
        expect(await client.host.memory.send('probe-server', 'reenter')).toBe(9)
        if (mode === 'reentrant') expect(await observed.nested).toBe(-1)
        sending.mockClear()
        expect(
          await Promise.all(
            Array.from({ length: 64 }, (_, value) =>
              client.host.memory.send('probe-server', 'echo', value)
            )
          )
        ).toEqual(Array.from({ length: 64 }, (_, value) => value))
        expect(business.calls).toEqual(Array.from({ length: 64 }, (_, value) => value))
        /** This reads actual physical records; it neither reframes nor executes business input. */
        const batches = sending.mock.calls.map(([frame]) =>
          frame.kind === 'extension' && frame.extension === 'batch@1'
            ? (frame.data as { frames: readonly IRpcCarrierFrame[] }).frames
            : undefined
        )
        expect(batches.some((members) => members !== undefined && members.length > 1)).toBe(true)
        expect(sending.mock.calls.length).toBeLessThan(64)
        expect(batches.reduce((total, members) => total + (members?.length ?? 1), 0)).toBe(64)
        /** Removed the Peer wrapper; the same original native error is restored directly. */
        const error = await client.host.memory
          .send('probe-server', 'fail')
          .catch((failure: unknown) => failure)
        expect(error).toBeInstanceOf(RangeError)
        expect(error).toMatchObject({
          source: 'rpc.endpoint',
          code: 'INTERNAL',
          name: original.name,
          message: original.message,
          stack: original.stack
        })
        /** Native reporting follows actual reply-write completion, rather than caller receipt. */
        await vi.waitFor(() => expect(business.reports).toContain(original))
        /** A complete executing timeout instance replaces only the retired numeric configuration. */
        const expired = await client.host.memory
          .send('probe-server', 'hold', undefined, { timeout: { ms: 10 } })
          .catch((failure: unknown) => failure)
        expect(expired).toBeInstanceOf(RpcTimeoutError)
        expect(expired).toMatchObject({ source: 'rpc.endpoint', code: 'DEADLINE_EXCEEDED' })
        /** The exact caller-owned native object remains the local coded abort's cause. */
        const controller = new AbortController()
        /** This original reason must never become the probe's unrelated sink failure. */
        const reason = new RangeError('probe isolation abort reason')
        /** The genuine caller owner observes cancellation before any late physical result. */
        const aborted = client.host.memory
          .send('probe-server', 'hold', undefined, { signal: controller.signal })
          .catch((failure: unknown) => failure)
        controller.abort(reason)
        /** Retain the actual public native failure for both family and exact-cause assertions. */
        const abortError = await aborted
        expect(abortError).toBeInstanceOf(RpcAbortError)
        expect(abortError).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
        expect((abortError as Error).cause).toBe(reason)
        held.resolve()
        expect(
          await client.host.memory.notify('echo', -2, { targetId: 'probe-server' })
        ).toBeUndefined()
        /** All original stream values come from the real provider and mandatory stream owner. */
        const values: unknown[] = []
        for await (const value of client.host.memory.stream('values') as AsyncIterable<unknown>)
          values.push(value)
        expect(values).toEqual([1, 2, 3])
        await observed.nested
        await vi.waitFor(() => expect(business.active).toBe(0))
        if (mode === 'absent') expect(observed.count).toBe(0)
        else expect(observed.count).toBeGreaterThan(0)
        if (mode === 'throw' || mode === 'reject')
          expect(observed.reports.length).toBeGreaterThan(0)
        else expect(observed.reports).toEqual([])
      } finally {
        held.resolve()
        sending.mockRestore()
        await Promise.all([client.host.close(), server.close()])
      }
    }
  )
})
