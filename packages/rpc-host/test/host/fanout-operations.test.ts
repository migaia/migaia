import { MessageChannel } from 'node:worker_threads'
import { createHmac } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, createUnitBudget } from '@migaia/supervision'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { defineTransportPlugin, defineFeaturePlugin } from '@migaia/rpc-host/plugin'
import type { IRpcHostMember } from '../../dist/plugin/types.js'
import type { IRemoteBinding } from '../../dist/remote/types.js'
import * as runtimeEndpoint from '../../dist/core/runtime-api-endpoint.js'
import type { IRpcFanoutResult } from '../../dist/core/typing.js'
import { createAdapterDeployment } from '../../dist/runtime-adapter/deployment.js'
import {
  createEventEmitterMessageResource,
  ownAdapterMessageClose
} from '../../dist/runtime-adapter/message/resource.js'
import { memoryServer, managedMemoryUnits, type IManagedMemoryUnit } from './fixture.js'

/** Target settlement keys are the public endpoint grammar, including names with punctuation. */
const key = (target: string) => JSON.stringify(['target', target])

/** Read actual fanout records only after asserting their null-prototype dictionary boundary. */
function fanout<T>(value: unknown): IRpcFanoutResult<T> {
  expect(value).toHaveProperty('fulfilled')
  expect(value).toHaveProperty('rejected')
  /** The structural assertions above precede inspection of the actual returned dictionaries. */
  const result = value as IRpcFanoutResult<T>
  expect(Object.getPrototypeOf(result.fulfilled)).toBeNull()
  expect(Object.getPrototypeOf(result.rejected)).toBeNull()
  return result
}

/** Drain only the actual returned iterator; sibling streams retain their own lifetimes. */
async function items(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  /** Application items are collected only for this finite business assertion. */
  const result: unknown[] = []
  for await (const item of stream) result.push(item)
  return result
}

/** Local physical errors must remain the same reachable instance through canonical wrappers. */
function containsCause(value: unknown, original: unknown): boolean {
  /** Error graphs may share cause/aggregate nodes; visit each actual object once. */
  const seen = new Set<object>()
  /** The canonical bounded error graph is traversed without rebuilding any error. */
  const remaining: unknown[] = [value]
  while (remaining.length) {
    /** Each candidate is either the original instance or an actual cause/aggregate edge. */
    const current = remaining.shift()
    if (current === original) return true
    if (typeof current !== 'object' || current === null || seen.has(current)) continue
    seen.add(current)
    if ('cause' in current) remaining.push(current.cause)
    if (current instanceof AggregateError) remaining.push(...current.errors)
  }
  return false
}

/** Hold actual MessagePorts so ownership transfer is proved by the native runtime. */
async function nativeHosts(provide: IRpcHostOptions['provide']) {
  /** Native backing transfer requires the existing authenticated manifest profile. */
  const signature = (value: unknown): string =>
    createHmac('sha256', 'public-host-fanout-fixture-key')
      .update(JSON.stringify(value))
      .digest('hex')
  /** Real signing and verification negotiate transfer without supplying capability flags. */
  const authentication = {
    sign: (value: unknown) => ({ value, signature: signature(value) }),
    verify: (value: unknown) => {
      /** The actual signed frame must survive native structured cloning unchanged. */
      const frame = value as { value: unknown; signature: string }
      expect(frame.signature).toBe(signature(frame.value))
      return frame.value
    }
  }
  /** These are genuine postMessage carriers, without a private capability flag supplied by a test. */
  const { port1, port2 } = new MessageChannel()
  /** Observe native writes before any canonical source or host can use these exact resources. */
  const writes = vi.spyOn(port1, 'postMessage')
  /** Provider writes distinguish physical notify sending from a remote business acknowledgement. */
  const replies = vi.spyOn(port2, 'postMessage')
  /** Each canonical resource retains its actual native port and terminal close operation. */
  const resources = [port1, port2].map((port) => {
    /** Receiver-preserving arrows expose only the real port's existing operations. */
    const resource = createEventEmitterMessageResource({
      postMessage: (message, transfer) =>
        port.postMessage(message, transfer as readonly ArrayBuffer[]),
      on: (event, listener) => {
        port.on(event, listener)
      },
      off: (event, listener) => {
        port.off(event, listener)
      }
    })
    ownAdapterMessageClose(resource, { close: () => port.close() })
    return resource
  })
  /** Both raw handshakes progress concurrently; no fake peer or endpoint stands in for either side. */
  const hosts = await Promise.all(
    resources.map((resource, index) =>
      createRpcHost({
        self: { name: `native-${index}`, instanceId: `native-${index}` },
        plugins: [
          defineTransportPlugin({
            name: `native-transport-${index}`,
            mode: 'connect',
            deployment: createAdapterDeployment({
              open: (context) => {
                /**
                 * The original clone-control owner derives native storage from the real carrier
                 * profile.
                 */
                const offer = rpcMessageCapabilityControl.localOffer(context.capabilities)
                if (!offer.valid) throw new TypeError(offer.field)
                return resource.open({
                  peerId: `native-${1 - index}`,
                  scheduler: systemScheduler,
                  offer: offer.value,
                  control: rpcMessageCapabilityControl,
                  signal: context.signal,
                  timeoutMs: context.connectTimeoutMs
                })
              }
            })
          })
        ],
        ...(index === 1 ? { provide } : {}),
        authentication,
        report: () => undefined
      })
    )
  )
  writes.mockClear()
  replies.mockClear()
  return { caller: hosts[0]!, provider: hosts[1]!, writes, replies, port1, port2 }
}

describe('host direct-target broadcast operations', () => {
  it('executes all five operations for zero, one and two sessions on one actual server endpoint', async () => {
    /** Spy preserves the real canonical factory implementation and counts by the actual server id. */
    const constructed = vi.spyOn(runtimeEndpoint, 'createRuntimeApiEndpoint')
    /** The server's one listener accepts additional channels without replacing its endpoint. */
    const server = memoryServer('matrix-server')
    /** Actual application notification effects are distinct from physical-send settlement. */
    const notifications: string[] = []
    /** Each notification barrier observes real provider execution without sleeps. */
    const firstNotified = deferred<void>()
    /** The second session has an independent provider execution barrier. */
    const secondNotified = deferred<void>()
    /** A later directed dispatch must invoke only the first target's real provider. */
    const firstDispatched = deferred<void>()
    /** Reports retain dispatch failure while request/notify failures remain on returned Promises. */
    const reports: unknown[] = []
    /** The host is the public new entry, backed by one actual native installation. */
    const host = await createRpcHost({
      ...server.options,
      report: (error) => {
        reports.push(error)
      }
    })
    /** Every returned connection is closed even if a later matrix assertion fails. */
    const clients: Awaited<ReturnType<typeof server.connect>>[] = []
    try {
      for (const empty of [
        await host.request('value'),
        await host.notify('note'),
        host.stream('sequence'),
        await host.group([{ method: 'value' }]),
        await host.outcome('absent')
      ]) {
        /** Zero peers means no scalar placeholder and no physical request. */
        const result = fanout(empty)
        expect(Object.keys(result.fulfilled)).toEqual([])
        expect(Object.keys(result.rejected)).toEqual([])
      }
      /** The first peer supplies actual business methods for every admitted mode. */
      const first = await server.connect('first', {
        provide: {
          value: (value?: unknown) => `first:${value ?? 'none'}`,
          note: () => {
            notifications.push('first')
            firstNotified.resolve()
            if (notifications.filter((name) => name === 'first').length === 3)
              firstDispatched.resolve()
          },
          sequence: async function* () {
            yield 'first:1'
            yield 'first:2'
          }
        }
      })
      clients.push(first)
      expect(await host.request('value', 1)).toBe('first:1')
      expect(await host.notify('note')).toBeUndefined()
      await firstNotified.promise
      expect(await items(host.stream('sequence') as AsyncIterable<unknown>)).toEqual([
        'first:1',
        'first:2'
      ])
      expect(
        await host.group([{ method: 'value', payload: 2 }], { idempotencyKey: 'single-group' })
      ).toEqual([{ state: 'success', result: 'first:2' }])
      expect(await host.outcome('single-group')).toMatchObject({
        state: 'done',
        outcome: {
          mode: 'group',
          completion: { ok: true, result: [{ state: 'success', result: 'first:2' }] }
        }
      })
      /** Punctuation in a peer name must remain one canonical target key. */
      const secondName = 'second["peer"]'
      /** The second accepted directory contributes its own independent application handlers. */
      const second = await server.connect(secondName, {
        provide: {
          value: (value?: unknown) => `second:${value ?? 'none'}`,
          note: () => {
            notifications.push('second')
            secondNotified.resolve()
          },
          sequence: async function* () {
            yield 'second:1'
          }
        }
      })
      clients.push(second)
      expect(fanout(await host.request('value', 3))).toEqual({
        fulfilled: { [key('first')]: 'first:3', [key(secondName)]: 'second:3' },
        rejected: {}
      })
      expect(fanout(await host.notify('note'))).toEqual({
        fulfilled: { [key('first')]: undefined, [key(secondName)]: undefined },
        rejected: {}
      })
      await secondNotified.promise
      expect(notifications.toSorted()).toEqual(['first', 'first', 'second'])
      /** Broadcast stream creates independent original iterators rather than one shared consumer. */
      const streams = fanout<AsyncIterable<unknown>>(host.stream('sequence'))
      expect(streams.rejected).toEqual({})
      expect(Object.keys(streams.fulfilled)).toEqual([key('first'), key(secondName)])
      expect(await items(streams.fulfilled[key('first')]!)).toEqual(['first:1', 'first:2'])
      expect(await items(streams.fulfilled[key(secondName)]!)).toEqual(['second:1'])
      expect(
        fanout(
          await host.group([{ method: 'value', payload: 4 }], { idempotencyKey: 'both-group' })
        )
      ).toEqual({
        fulfilled: {
          [key('first')]: [{ state: 'success', result: 'first:4' }],
          [key(secondName)]: [{ state: 'success', result: 'second:4' }]
        },
        rejected: {}
      })
      /** Each result belongs to the queried target's actual canonical outcome store. */
      const outcomes = fanout<{ state: string; outcome: { completion: { result: unknown } } }>(
        await host.outcome('both-group')
      )
      expect(outcomes.rejected).toEqual({})
      expect(outcomes.fulfilled[key('first')]).toMatchObject({
        state: 'done',
        outcome: { completion: { result: [{ state: 'success', result: 'first:4' }] } }
      })
      expect(outcomes.fulfilled[key(secondName)]).toMatchObject({
        state: 'done',
        outcome: { completion: { result: [{ state: 'success', result: 'second:4' }] } }
      })
      expect(await host.send('first', 'value', 5)).toBe('first:5')
      /** Directed dispatch returns void while its selected provider still executes asynchronously. */
      const otherWrites = vi.spyOn(second.pair[0], 'send')
      expect(host.dispatch('first', 'note')).toBeUndefined()
      await firstDispatched.promise
      await nextTurn()
      expect(otherWrites).not.toHaveBeenCalled()
      expect(notifications.toSorted()).toEqual(['first', 'first', 'first', 'second'])
      otherWrites.mockRestore()
      await expect(host.send('not-direct', 'value')).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
      host.dispatch('not-direct', 'value')
      expect(reports).toEqual([expect.objectContaining({ code: 'TARGET_UNKNOWN' })])
      /**
       * A legal punctuation-bearing peer name remains usable through a normal explicit provider
       * alias.
       */
      host.provide({ relayed: host.peers[secondName]!.value })
      /** A third actual listen session still borrows the same original server endpoint. */
      const third = await server.connect('third', { provide: { value: () => 'third' } })
      clients.push(third)
      expect(await host.send('third', 'value')).toBe('third')
      expect(await third.host.send('matrix-server', 'relayed', 6)).toBe('second:6')
      expect(
        constructed.mock.calls.filter(([config]) => 'id' in config && config.id === 'matrix-server')
      ).toHaveLength(1)
    } finally {
      for (const client of clients.reverse()) await client.host.close()
      await host.close()
      constructed.mockRestore()
    }
  })

  it('opens three genuine managed units behind one logical target and one host endpoint', async () => {
    /** Count the real endpoint owner while retaining its complete construction implementation. */
    const constructed = vi.spyOn(runtimeEndpoint, 'createRuntimeApiEndpoint')
    /** All three original supervisors share the actual existing lease budget. */
    const budget = createUnitBudget({ kind: 'assembled-memory', maxUnits: 3, launchRate: false })
    /** This is the same raw launcher/profile as reconnect acceptance, without replacement policy. */
    const { units, launcher, profile } = managedMemoryUnits({
      kind: 'assembled-memory',
      provide: (ordinal) => ({
        value: () => ordinal,
        async *values() {
          yield ordinal
          yield ordinal + 10
        }
      })
    })
    /** Public supervisor state is observed only to confirm actual disposal after lease release. */
    const supervisors: { readonly state: string }[] = []
    /** Each captured member is the canonical managed projection, never an invented peer object. */
    const members: IRpcHostMember[] = []
    /** Native reports retain their actual errors for assertion diagnostics. */
    const reports: unknown[] = []
    /** Every openMember call captures an independent real supervisor binding before raw handshake. */
    const transport = defineTransportPlugin({
      name: 'assembled-transport',
      mode: 'spawn',
      deployment: createAdapterDeployment({
        open: async () => {
          throw new Error('managed members must use the existing supervisor binding')
        },
        managed: async (prepared) => {
          /** No state or unit lifetime is recreated by the assembler or by the Host fixture. */
          const supervisor = createSupervisor({
            id: `assembled-memory-${supervisors.length + 1}`,
            spec: 'remote',
            launcher,
            profile,
            budget,
            report: (error) => reports.push(error)
          })
          supervisors.push(supervisor)
          return {
            binding: {
              ownership: 'owned',
              supervisor,
              scheduler: systemScheduler,
              openChannel: (unit: IManagedMemoryUnit, signal: AbortSignal) =>
                unit.source.open({ ...prepared, signal })
            } as IRemoteBinding<unknown, unknown>
          }
        }
      })
    })
    /** Choosing the first genuine member proves assembly shape without implementing pool scheduling. */
    const assembler = defineFeaturePlugin({
      name: 'three-members',
      async assemble(context) {
        for (let index = 0; index < 3; index++) members.push(await context.openMember())
        return Object.freeze({ ...members[0]!, id: 'pool' })
      }
    })
    /**
     * Failed construction still relies on the real Host rollback before the fixture closes
     * admission.
     */
    let host: Awaited<ReturnType<typeof createRpcHost>> | undefined
    try {
      host = await createRpcHost({
        self: { name: 'assembled-host', instanceId: 'assembled-host' },
        plugins: [transport, assembler],
        report: (error) => reports.push(error)
      })
      expect(units).toHaveLength(3)
      expect(new Set(units.map((unit) => unit.identity.fingerprint)).size).toBe(3)
      expect(budget.inUse).toBe(3)
      expect(members).toHaveLength(3)
      for (const [index, member] of members.entries()) {
        expect(await member.request('value')).toBe(index + 1)
        expect(await items(member.stream('values'))).toEqual([index + 1, index + 11])
      }
      /** One logical target yields one scalar operation despite three real live physical members. */
      expect(await host.request('value')).toBe(1)
      expect(await host.send('pool', 'value')).toBe(1)
      expect(Object.keys(host.peers)).not.toContain('remote')
      await expect(host.send('remote', 'value')).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
      for (const unit of units)
        await expect(host.send(unit.remote.self.instanceId, 'value')).rejects.toMatchObject({
          code: 'TARGET_UNKNOWN'
        })
      expect(
        constructed.mock.calls.filter(
          ([config]) => 'id' in config && config.id === 'assembled-host'
        )
      ).toHaveLength(1)
      /** The remote units each own one endpoint; managed local projections must create no extras. */
      expect(constructed).toHaveBeenCalledTimes(4)
    } finally {
      await host?.close()
      budget.close()
      constructed.mockRestore()
    }
    expect(supervisors).toHaveLength(3)
    expect(supervisors.map((supervisor) => supervisor.state)).toEqual([
      'disposed',
      'disposed',
      'disposed'
    ])
    expect(budget.inUse).toBe(0)
    expect(budget.pending).toBe(0)
    expect(reports).toEqual([])
  })

  it.each(['request', 'notify', 'group', 'outcome'] as const)(
    '%s isolates one actual physical send failure from the other target settlement',
    async (operation) => {
      /** Both sessions are fully accepted before the original physical write is made to fail. */
      const server = memoryServer(`failure-${operation}`)
      /** Provider invocation distinguishes a fulfilled send from merely exposing a method property. */
      const executed = deferred<void>()
      /** The host contains the same one canonical endpoint throughout this operation. */
      const host = await createRpcHost(server.options)
      /** A's source fails locally, without closing the independently live B source. */
      const first = await server.connect('first', {
        provide: { value: () => 'first', note: () => undefined }
      })
      /** B's actual provider must still execute and settle normally. */
      const second = await server.connect('second', {
        provide: {
          value: () => {
            executed.resolve()
            return 'second'
          },
          note: () => {
            executed.resolve()
          }
        }
      })
      /** The same native error remains reachable in the local target's rejected record. */
      const original = new RangeError('selected physical write failed')
      /** Failure is injected into the existing actual sender, after successful native handshakes. */
      const write = vi.spyOn(first.pair[0], 'send').mockImplementation(() => {
        throw original
      })
      try {
        /** Every operation uses the same public facade; no fake peer supplies a precomputed result. */
        const value =
          operation === 'request'
            ? await host.request('value')
            : operation === 'notify'
              ? await host.notify('note')
              : operation === 'group'
                ? await host.group([{ method: 'value' }])
                : await host.outcome('unknown-key')
        /** Fanout retains exact canonical keys even when only one target rejects. */
        const result = fanout(value)
        expect(Object.keys(result.rejected)).toEqual([key('first')])
        expect(Object.keys(result.fulfilled)).toEqual([key('second')])
        expect(containsCause(result.rejected[key('first')], original)).toBe(true)
        if (operation === 'request') expect(result.fulfilled[key('second')]).toBe('second')
        else if (operation === 'group')
          expect(result.fulfilled[key('second')]).toEqual([{ state: 'success', result: 'second' }])
        else if (operation === 'outcome')
          expect(result.fulfilled[key('second')]).toMatchObject({ state: 'unknown' })
        else expect(result.fulfilled[key('second')]).toBeUndefined()
        if (operation !== 'outcome') await executed.promise
      } finally {
        write.mockRestore()
        await second.host.close()
        await first.host.close()
        await host.close()
      }
    }
  )

  it('a failing returned stream does not cancel the independently successful sibling iterator', async () => {
    /** Both original provider iterators run through real host stream admission and credit control. */
    const server = memoryServer('stream-isolation')
    /** The host remains one endpoint while two independent physical sessions supply generators. */
    const host = await createRpcHost(server.options)
    /** A's failure occurs after yielding, so its iterator already exists in fulfilled. */
    const first = await server.connect('first', {
      provide: {
        sequence: async function* () {
          yield 1
          throw new RangeError('stream business failure')
        }
      }
    })
    /** B must finish after A's failure without cancellation or lost items. */
    const second = await server.connect('second', {
      provide: {
        sequence: async function* () {
          yield 2
          yield 3
        }
      }
    })
    try {
      /** Iterator creation succeeds for both; a later generator error belongs to that iterator. */
      const streams = fanout<AsyncIterable<unknown>>(host.stream('sequence'))
      expect(streams.rejected).toEqual({})
      expect(Object.keys(streams.fulfilled)).toEqual([key('first'), key('second')])
      await expect(items(streams.fulfilled[key('first')]!)).rejects.toMatchObject({
        message: 'stream business failure'
      })
      expect(await items(streams.fulfilled[key('second')]!)).toEqual([2, 3])
    } finally {
      await second.host.close()
      await first.host.close()
      await host.close()
    }
  })

  it('notify awaits the original physical write and does not await or receive a business reply', async () => {
    /** The provider deliberately stays in progress after its notification has been delivered. */
    const businessEntered = deferred<void>()
    /** Caller-owned release makes remote business completion independently observable. */
    const releaseBusiness = deferred<void>()
    /** Provider completion proves that no response frame appears even after the handler settles. */
    const businessDone = deferred<void>()
    /** A real native-style memory source exposes its original physical completion Promise. */
    const server = memoryServer('notify-send')
    /** One target returns scalar void while preserving the same canonical sender owner. */
    const host = await createRpcHost(server.options)
    /** The actual provider receives the notification without returning an acknowledgement. */
    const client = await server.connect('client', {
      provide: {
        note: async () => {
          businessEntered.resolve()
          await releaseBusiness.promise
          businessDone.resolve()
        }
      }
    })
    /** Hold only physical completion; the actual existing transport still performs delivery. */
    const physicalEntered = deferred<void>()
    /** The caller's notify Promise must remain pending until this original write completes. */
    const releasePhysical = deferred<void>()
    /**
     * Capture the real method through an arrow, preserving its original receiver-free
     * implementation.
     */
    const original = client.pair[0].send
    /** Actual provider-to-caller frames remain observable independently of business execution. */
    const replies = vi.spyOn(client.pair[1], 'send')
    /** Only this current public notify's one actual write is held. */
    const write = vi.spyOn(client.pair[0], 'send').mockImplementationOnce((frame, options) => {
      original(frame, options)
      physicalEntered.resolve()
      return releasePhysical.promise
    })
    try {
      /** Settlement observation is registered before the native write or provider can run. */
      let settled = false
      /** No request/reply channel is substituted for the new facade notification. */
      const pending = host.notify('note').then((result) => {
        settled = true
        return result
      })
      await physicalEntered.promise
      await businessEntered.promise
      expect(settled).toBe(false)
      releasePhysical.resolve()
      expect(await pending).toBeUndefined()
      releaseBusiness.resolve()
      await businessDone.promise
      await nextTurn()
      expect(replies).not.toHaveBeenCalled()
    } finally {
      releasePhysical.resolve()
      releaseBusiness.resolve()
      write.mockRestore()
      replies.mockRestore()
      await client.host.close()
      await host.close()
    }
  })

  it('notify transfers an actual native backing through postMessage and preserves native write failure cause', async () => {
    /**
     * The receiver records its actual restored business backing, rather than inspecting a wire
     * marker.
     */
    const received = deferred<unknown>()
    /** Both hosts use real canonical MessagePort resources and public host/plugin entries. */
    const pair = await nativeHosts({
      note: (value: unknown) => {
        received.resolve(value)
      }
    })
    try {
      /** A genuine transferable backing carries a nonzero business byte. */
      const backing = new ArrayBuffer(8)
      new Uint8Array(backing)[0] = 42
      await pair.caller.notify('note', backing, { transfer: [backing] })
      expect(backing.byteLength).toBe(0)
      expect(pair.writes.mock.calls.some(([, transfer]) => transfer?.includes(backing))).toBe(true)
      /** Canonical restoration delivers an actual ArrayBuffer with its original bytes. */
      const value = await received.promise
      expect(value).toBeInstanceOf(ArrayBuffer)
      expect([...new Uint8Array(value as ArrayBuffer)]).toEqual([42, 0, 0, 0, 0, 0, 0, 0])
      await nextTurn()
      expect(pair.replies).not.toHaveBeenCalled()
      /**
       * A native postMessage exception must reject locally with the exact original on its cause
       * path.
       */
      const original = new RangeError('native postMessage refused')
      pair.writes.mockImplementationOnce(() => {
        throw original
      })
      /** Catch at the caller only; no hand-written transport Promise simulates the failure result. */
      const failure = await pair.caller.notify('note', 1).then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
      expect(containsCause(failure, original)).toBe(true)
    } finally {
      pair.writes.mockRestore()
      pair.replies.mockRestore()
      await pair.caller.close()
      await pair.provider.close()
      pair.port1.close()
      pair.port2.close()
    }
  })

  it('rejects a real forwarding cycle before reentering the original business provider', async () => {
    /** Existing listeners are connected into a cycle without replacing their endpoint identities. */
    const b = memoryServer('loop-b')
    /** C first captures B's original provider through an accepted generation. */
    const c = memoryServer('loop-c')
    /** A later advertises the same capability after its existing C connection is established. */
    const a = memoryServer('loop-a')
    /** Reentering B's terminal method must be prevented by the canonical forward-route owner. */
    let executions = 0
    /** Each host creates exactly its own normal endpoint; links only add raw physical sessions. */
    const hostB = await createRpcHost({ ...b.options, provide: { value: () => ++executions } })
    /** The relay's method is registered only after capturing its real remote capability. */
    const hostC = await createRpcHost(c.options)
    /** This third host preserves the live old links while a new graph edge closes the cycle. */
    const hostA = await createRpcHost(a.options)
    /** Caller construction happens after the real forwarded catalog has been published. */
    let caller: Awaited<ReturnType<typeof b.connect>> | undefined
    try {
      await c.link(b)
      hostC.provide({ relay: hostC.peers['loop-b']!.value! })
      await a.link(c)
      hostA.provide({ relay: hostA.peers['loop-c']!.relay! })
      await b.link(a)
      hostB.provide({ loop: hostB.peers['loop-a']!.relay! })
      caller = await b.connect('loop-caller')
      expect(await caller.host.send('loop-b', 'value')).toBe(1)
      await expect(caller.host.send('loop-b', 'loop')).rejects.toMatchObject({
        code: 'FORWARD_LOOP'
      })
      expect(executions).toBe(1)
    } finally {
      await caller?.host.close()
      await hostA.close()
      await hostC.close()
      await hostB.close()
    }
  })

  it('permits three actual forwarding hosts and rejects the fourth before the terminal provider', async () => {
    /** The bounded chain reuses actual accepted capability functions, without a fixture dispatcher. */
    const servers = Array.from({ length: 5 }, (_, index) => memoryServer(`hop-${index}`))
    /** Every successful terminal call is a real observable business effect. */
    let executions = 0
    /** Hold only actual public host handles for reverse cleanup. */
    const hosts: Awaited<ReturnType<typeof createRpcHost>>[] = []
    /** Independent external callers select the supported boundary and one excessive hop. */
    const callers: Awaited<ReturnType<(typeof servers)[0]['connect']>>[] = []
    try {
      for (const [index, server] of servers.entries()) {
        /** Register each relay before the next actual connection snapshots its provider catalog. */
        const host = await createRpcHost({
          ...server.options,
          ...(index === 0 ? { provide: { value: () => ++executions } } : {})
        })
        hosts.push(host)
        if (index > 0) {
          await server.link(servers[index - 1]!)
          /** Held capabilities retain their original source/generation forwarding identity. */
          const previous = host.peers[`hop-${index - 1}`]!
          host.provide({ relay: previous[index === 1 ? 'value' : 'relay']! })
        }
      }
      /** Three forwarding nodes must preserve the existing successful business path. */
      const allowed = await servers[3]!.connect('allowed-caller')
      callers.push(allowed)
      expect(await allowed.host.send('hop-3', 'relay')).toBe(1)
      /** The next independent caller reaches the original explicit hop-limit branch. */
      const excessive = await servers[4]!.connect('excessive-caller')
      callers.push(excessive)
      await expect(excessive.host.send('hop-4', 'relay')).rejects.toMatchObject({
        code: 'FORWARD_HOP_LIMIT'
      })
      expect(executions).toBe(1)
    } finally {
      for (const caller of callers.reverse()) await caller.host.close()
      for (const host of hosts.reverse()) await host.close()
    }
  })
})
