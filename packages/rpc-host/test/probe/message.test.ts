import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import {
  probe,
  defineProbe,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import limits from '@migaia/rpc-host/plugins/limits'
import { describe, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

describe('probe logical observations', () => {
  it('records request progress, provider errors, timeout, abort, notify, ping and admission refusal', async () => {
    /** Snapshot only at the test consumer boundary because the production view is reusable. */
    const caller: IRpcProbeEventView[] = [],
      provider: IRpcProbeEventView[] = []
    /** Native business failure must remain reachable from the provider event. */
    const original = new RangeError('probe provider failure')
    /** A real provider lease remains occupied until the test releases it. */
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Actual provider invocations distinguish refusal from accidental business execution. */
    const calls: string[] = []
    /** Both compiled observers are owned by their actual endpoint emitters. */
    const leftProbe = defineProbe({
      stages: ['message'],
      emit: (event) => caller.push(Object.freeze({ ...event }))
    })
    const rightProbe = defineProbe({
      stages: ['message'],
      emit: (event) => provider.push(Object.freeze({ ...event }))
    })
    /** One existing listener/MemoryCarrier pair installs genuine readonly probes and limits. */
    const listener = coreMemoryServer('provider', 'probe-provider')
    /** Provider callbacks preserve the original business effects and exact native failure. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [
        probe(rightProbe),
        rpcFeaturesPlugin({ features: { feature0: limits({ maxGlobal: 1, maxPerPeer: 1 }) } }),
        ...listener.options.plugins!
      ],
      provide: {
        echo: (data) => {
          calls.push('echo')
          return data
        },
        fail: () => {
          calls.push('fail')
          throw original
        },
        hold: async () => {
          calls.push('hold')
          await held
          return 'released'
        }
      }
    })
    /** The caller uses the same public native installation rather than an endpoint facade. */
    const connected = await listener.connect(
      'caller',
      { plugins: [probe(leftProbe)] },
      'probe-caller'
    )
    const client = connected.host
    try {
      expect(
        await client.memory.send('probe-provider', 'echo', 42, { trace: 'explicit-trace' })
      ).toBe(42)
      /** The actual caller-side request id selects corresponding provider and response records. */
      const created = caller.find(
        (event) =>
          event.kind === RpcProbeKind.request &&
          event.outcome === RpcProbeOutcome.created &&
          event.method === 'echo'
      )!
      expect(created).toMatchObject({
        stage: RpcProbeStage.message,
        direction: RpcProbeDirection.outbound,
        senderId: 'probe-caller',
        targetId: 'probe-provider',
        trace: 'explicit-trace'
      })
      expect(
        caller
          .filter(
            (event) => event.kind === RpcProbeKind.request && event.messageId === created.messageId
          )
          .map((event) => event.outcome)
      ).toEqual([RpcProbeOutcome.created, RpcProbeOutcome.sent, RpcProbeOutcome.settled])
      /** Caller receipt precedes the original provider's response-send continuation and cleanup. */
      await vi.waitFor(() =>
        expect(
          provider
            .filter(
              (event) =>
                event.kind === RpcProbeKind.request && event.messageId === created.messageId
            )
            .map((event) => event.outcome)
        ).toEqual([RpcProbeOutcome.received, RpcProbeOutcome.admitted, RpcProbeOutcome.settled])
      )
      for (const event of provider.filter(
        (event) => event.messageId === created.messageId && event.kind === RpcProbeKind.request
      ))
        expect(event).toMatchObject({
          method: 'echo',
          senderId: 'probe-caller',
          trace: 'explicit-trace'
        })
      expect(
        caller.find(
          (event) =>
            event.messageId === created.messageId && event.outcome === RpcProbeOutcome.settled
        )?.durationMs
      ).toBeGreaterThanOrEqual(0)
      expect(
        caller.some(
          (event) =>
            event.kind === RpcProbeKind.response && event.outcome === RpcProbeOutcome.received
        )
      ).toBe(true)
      expect(
        provider.some(
          (event) => event.kind === RpcProbeKind.response && event.outcome === RpcProbeOutcome.sent
        )
      ).toBe(true)
      await expect(client.memory.send('probe-provider', 'fail', undefined)).rejects.toMatchObject({
        code: 'INTERNAL'
      })
      await vi.waitFor(() =>
        expect(
          provider.find(
            (event) => event.method === 'fail' && event.outcome === RpcProbeOutcome.failed
          )?.error
        ).toBe(original)
      )
      client.memory.dispatch('probe-provider', 'echo', 7)
      await vi.waitFor(() => expect(calls.filter((method) => method === 'echo')).toHaveLength(2))
      expect(
        caller.some(
          (event) => event.kind === RpcProbeKind.notify && event.outcome === RpcProbeOutcome.sent
        )
      ).toBe(true)
      /** Timeout wins locally while the same genuine lease prevents another provider admission. */
      await expect(
        client.memory.send('probe-provider', 'hold', undefined, { timeout: { ms: 10 } })
      ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await expect(client.memory.send('probe-provider', 'echo', undefined)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(provider.find((event) => event.outcome === RpcProbeOutcome.rejected)?.rejection).toBe(
        'concurrency'
      )
      release()
      await vi.waitFor(() =>
        expect(
          provider.some(
            (event) => event.method === 'hold' && event.outcome === RpcProbeOutcome.settled
          )
        ).toBe(true)
      )
      /** Abort retains the exact native caller reason and emits its logical cancellation. */
      const controller = new AbortController(),
        reason = new Error('probe caller abort')
      const operation = client.memory.send('probe-provider', 'echo', 1, {
        signal: controller.signal
      })
      controller.abort(reason)
      await expect(operation).rejects.toMatchObject({ code: 'CANCELLED', cause: reason })
      expect(
        caller.some(
          (event) =>
            event.kind === RpcProbeKind.request &&
            event.outcome === RpcProbeOutcome.failed &&
            event.durationMs >= 0
        )
      ).toBe(true)
      expect(caller.some((event) => event.kind === RpcProbeKind.cancel)).toBe(true)
    } finally {
      release()
      await Promise.all([client.close(), server.close()])
    }
  })

  it('records native host request, notify and three stream chunks through the actual runtime path', async () => {
    /** Separate snapshots retain both endpoints without introducing another runtime observer. */
    const left: IRpcProbeEventView[] = [],
      right: IRpcProbeEventView[] = []
    /** Both sinks remain genuine public probe options on independently owned hosts. */
    const listener = coreMemoryServer('provider', 'probe-native-provider')
    /** The real provider and original three yields are unchanged. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [
        probe({ stages: ['message'], emit: (event) => right.push(Object.freeze({ ...event })) }),
        ...listener.options.plugins!
      ],
      provide: {
        echo: (value: unknown) => value,
        values: async function* () {
          yield 1
          yield 2
          yield 3
        }
      }
    })
    /** Actual memory namespace selection replaces the retired single-Peer facade. */
    const connected = await listener.connect(
      'caller',
      {
        plugins: [
          probe({ stages: ['message'], emit: (event) => left.push(Object.freeze({ ...event })) })
        ]
      },
      'probe-native-caller'
    )
    const client = connected.host
    try {
      expect(await client.memory.request('echo', 42, { orderKey: 'probe-native' })).toBe(42)
      await client.memory.notify('echo', 7, { orderKey: 'probe-native' })
      /** Three actual iterator pulls must retain their original values and terminal outcome. */
      const values: unknown[] = []
      /** One actual direct target selects the public iterator branch rather than fanout. */
      const stream = client.memory.stream('values', undefined, {
        orderKey: 'probe-native'
      })
      expect(Symbol.asyncIterator in stream).toBe(true)
      if (!(Symbol.asyncIterator in stream)) return expect.unreachable()
      for await (const value of stream) values.push(value)
      expect(values).toEqual([1, 2, 3])
      expect(
        left.some(
          (event) =>
            event.kind === RpcProbeKind.request && event.outcome === RpcProbeOutcome.settled
        )
      ).toBe(true)
      expect(
        right.some(
          (event) =>
            event.kind === RpcProbeKind.request && event.outcome === RpcProbeOutcome.admitted
        )
      ).toBe(true)
      expect(
        left.some(
          (event) => event.kind === RpcProbeKind.notify && event.outcome === RpcProbeOutcome.sent
        )
      ).toBe(true)
      expect(left.some((event) => event.kind === RpcProbeKind.streamOpen)).toBe(true)
      expect(
        left.filter(
          (event) =>
            event.kind === RpcProbeKind.streamChunk && event.direction === RpcProbeDirection.inbound
        )
      ).toHaveLength(3)
      expect(left.some((event) => event.kind === RpcProbeKind.streamClose)).toBe(true)
    } finally {
      await Promise.all([client.close(), server.close()])
    }
  })
})
