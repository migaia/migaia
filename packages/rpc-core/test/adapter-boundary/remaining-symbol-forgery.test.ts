import { assert, describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile, type IRpcPortableValue } from '@migaia/rpc-contract'
import type { IPluginRuntimeSharedSlot } from '@migaia/plugin-host'
import type { IRpcContext, IRpcProviderResult } from '../../dist/core/index.js'
import { RpcCoreErrorCode } from '../../dist/core/errors.js'
import {
  ProviderExecutor,
  type IProviderRequestInput
} from '../../dist/core/internal/provider-executor.js'
import { ProviderAdmissionRegistry } from '../../dist/core/internal/provider-admission.js'
import { ProviderRegistry } from '../../dist/core/internal/provider.js'
import {
  createForwardOptions,
  createForwardQueryOptions,
  createOutboundEnvelope,
  isForwardedOperation,
  isForwardedPayload,
  readForwardRoute,
  retainForwardOptions
} from '../../dist/core/internal/outbound-envelope.js'
import {
  prepareRuntimeStreamConsumer,
  retainRuntimeStreamPreparation
} from '../../dist/core/internal/stream/owner.js'
import {
  createRuntimeOutlet,
  readRuntimeOutletConnection,
  readRuntimeOutletEvents,
  type IRuntimeOutlet,
  type IRuntimePluginConnection
} from '../../dist/remote/runtime-api/outlet.js'
import type { IRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import {
  RuntimeEventName,
  RuntimePluginKey,
  RuntimeQueryClock
} from '../../dist/remote/runtime-api/constants.js'
import type { IRuntimeEvent } from '../../dist/remote/runtime-api/events.js'

/** Copy every own descriptor, including Symbols and non-enumerable fields, without invoking getters. */
function copyAllDescriptors<T extends object>(source: T): T {
  /** The attacker selects a separate object with exactly the original reflected properties. */
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source)) as T
  expect(copy).not.toBe(source)
  expect(Reflect.ownKeys(source).length).toBeGreaterThan(0)
  expect(Object.getOwnPropertyDescriptors(copy)).toEqual(Object.getOwnPropertyDescriptors(source))
  return copy
}

/** Existing normalized request admission reaches the real executor settlement boundary. */
function request(payload: IRpcPortableValue): IProviderRequestInput {
  /** Only fixture payload changes between the genuine and descriptor-copy executions. */
  const envelope = normalizeRpcEnvelope({
    kind: 'request',
    id: 'forgery-task',
    method: 'test',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'request',
        applicationVersion: '1',
        senderId: 'peer',
        targetId: 'host',
        sentAt: 0
      },
      payload
    }
  })
  assert(envelope.kind === 'request')
  return { envelope, route: envelope.data }
}

/** Genuine forwarding options carry the original ordinary provider context and admitted payload. */
function context(): IRpcContext {
  return {
    localEndpointId: 'fixture-local-endpoint',
    data: null,
    signal: new AbortController().signal,
    senderId: 'peer',
    success: (data) => ({ ok: true, data }),
    failed: (message, code) => ({ ok: false, message, code }),
    dispatchTo: () => undefined
  }
}

/** The existing outlet owner receives a slot and an exact receipt, with no new production seam. */
function outlet() {
  /** Requests must return this exact original operation Promise. */
  const result = Promise.resolve<IRpcPortableValue>('peer-business-value')
  /** Only the supported request path is exercised by this bounded peer fixture. */
  const invoke = vi.fn((_method: string, _payload?: unknown, _options?: unknown) => result)
  /** Connection routing retains the same original Peer and committed receipt. */
  const peer = { request: invoke } as unknown as IRuntimePeer
  /** Safe connection identity accompanies its exact Peer without becoming an admission flag. */
  const connection: IRuntimePluginConnection = {
    name: 'worker',
    instanceId: 'instance-1',
    identity: { name: 'worker', instanceId: 'instance-1' },
    description: undefined,
    peer,
    report: vi.fn()
  }
  /** The slot's existing index remains the sole connection authority. */
  const find = vi.fn((_target: string): IRuntimePluginConnection | null | undefined => connection)
  /** Construction never reads the facade field; actual reads use this same slot's index. */
  const slot: IPluginRuntimeSharedSlot<IRuntimeOutlet> = {
    facade: {} as IRuntimeOutlet,
    find,
    values: () => [connection],
    registered: () => [],
    register: () => undefined,
    contribute: () => () => undefined
  }
  /** This is the genuine frozen facade created by the canonical existing owner. */
  const facade = createRuntimeOutlet(
    slot,
    { name: 'host', instanceId: 'host-1' },
    RuntimePluginKey.thread
  )
  return { facade, connection, find, invoke, result }
}

describe('remaining trust markers reject copied reflected descriptors', () => {
  it.each(['success', 'failed'] as const)(
    '[APS7-S6] rejects a copied %s settlement and preserves genuine business metadata',
    async (kind) => {
      /** Genuine result creation snapshots this exact transfer object without rebuilding it. */
      const transfer = {}
      /** Wire responses and transfer lists are observed through the original executor send port. */
      const sent: Array<{ response: unknown; transfer?: readonly unknown[] }> = []
      /** One actual registry invokes the provider for both attacker and genuine inputs. */
      const registry = new ProviderRegistry()
      registry.register('test', (value) => {
        /** Success and failure originate from this exact task's canonical context. */
        const genuine: IRpcProviderResult =
          kind === 'success'
            ? value.success('provider-business-value', { transfer: [transfer] })
            : value.failed('provider-business-failure', 'BUSINESS_FAILURE')
        expect(Object.isFrozen(genuine)).toBe(true)
        return value.data === 'forged' ? copyAllDescriptors(genuine) : genuine
      })
      /** No deadline is requested, so timer ports exist without scheduling unrelated work. */
      const executor = new ProviderExecutor<string>({
        now: () => 0,
        timestamp: () => 0,
        setTimeout: (run, delay) => {
          /** The executor's ordinary timer has the same original clear ownership. */
          const handle = globalThis.setTimeout(run, delay)
          return { clear: () => globalThis.clearTimeout(handle) }
        },
        clearTimeout: (timer) => timer.clear(),
        id: 'host',
        registry,
        controllers: new Map(),
        admission: new ProviderAdmissionRegistry(),
        peers: [],
        dispatch: () => undefined,
        send: async (response, responseTransfer) => {
          sent.push({ response, transfer: responseTransfer })
        },
        validate: () => undefined,
        emitFailure: () => undefined
      })
      await executor.execute(request('forged'))
      expect(sent).toEqual([
        {
          response: expect.objectContaining({
            ok: false,
            code: RpcCoreErrorCode.providerNotSettled
          }),
          transfer: undefined
        }
      ])
      await executor.execute(request('genuine'))
      expect(sent).toHaveLength(2)
      if (kind === 'success') {
        expect(sent[1]?.response).toMatchObject({ ok: true, data: 'provider-business-value' })
        expect(sent[1]?.transfer).toEqual([transfer])
        expect(sent[1]?.transfer?.[0]).toBe(transfer)
        expect(Object.isFrozen(sent[1]?.transfer)).toBe(true)
      } else {
        expect(sent[1]?.response).toMatchObject({
          ok: false,
          message: 'provider-business-failure',
          code: 'BUSINESS_FAILURE'
        })
        expect(sent[1]?.transfer).toBeUndefined()
      }
    }
  )

  it('[APS7-S7] ignores copied route descriptors while preserving query retention and wire projection', () => {
    /** A valid signed route is retained by identity until canonical wire normalization snapshots it. */
    const route = Object.freeze([
      '0123456789abcdef0123456789abcdef',
      'fedcba9876543210fedcba9876543210'
    ])
    /** Genuine options retain the independently admitted payload proof. */
    const genuine = createForwardOptions(context(), route)
    /** Reflection creates another object with the same signal and every old private Symbol. */
    const forged = copyAllDescriptors(genuine)
    expect(readForwardRoute(forged)).toBeUndefined()
    expect(isForwardedOperation(forged)).toBe(false)
    expect(isForwardedPayload(forged, null)).toBe(false)
    /** Canonical copying cannot propagate route authority from an unrecognized source object. */
    const ignored = retainForwardOptions(forged, {})
    expect(readForwardRoute(ignored)).toBeUndefined()
    expect(isForwardedOperation(ignored)).toBe(false)
    expect(readForwardRoute(genuine)).toBe(route)
    expect(isForwardedPayload(genuine, null)).toBe(true)
    /** Legitimate owner reconstruction preserves both independent identity facts. */
    const retained = retainForwardOptions(genuine, {})
    expect(readForwardRoute(retained)).toBe(route)
    expect(isForwardedPayload(retained, null)).toBe(true)
    /** The unchanged existing projection includes only the admitted real route and business payload. */
    const projected = createOutboundEnvelope(request(null).envelope, retained)
    assert(projected.kind === 'request')
    expect(projected.data.route.forwardRoute).toEqual(route)
    expect(projected.data.payload).toBeNull()
    /** Queries intentionally have route provenance without a payload admission receipt. */
    const query = createForwardQueryOptions(route)
    expect(readForwardRoute(query)).toBe(route)
    expect(isForwardedOperation(query)).toBe(false)
    expect(readForwardRoute(retainForwardOptions(query, {}))).toBe(route)
  })

  it('[APS7-S8] rejects copied stream preparation while preserving iterator, callback and Promise identity', async () => {
    /** The original preparation operation returns this same Promise without issuing a pull. */
    const prepared = Promise.resolve()
    /** A public pull observes business data only when explicitly requested. */
    const next = vi.fn(async () => ({ done: false as const, value: 'stream-business-value' }))
    /** The same original managed iterator remains callable after private retention. */
    const original: AsyncIterableIterator<IRpcPortableValue> = {
      next,
      [Symbol.asyncIterator]() {
        return this
      }
    }
    /** Preparation must never run on behalf of the copied iterator. */
    const prepare = vi.fn(() => prepared)
    /** Canonical retention keeps the exact original object, its pull and its preparation Promise. */
    const genuine = retainRuntimeStreamPreparation(original, prepare)
    expect(genuine).toBe(original)
    expect(genuine.next).toBe(next)
    /** Copies include the built-in iterator method and every reflected old trust descriptor. */
    const forged = copyAllDescriptors(genuine)
    expect(() => prepareRuntimeStreamConsumer(forged)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.capabilityUnsupported })
    )
    expect(prepare).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(prepareRuntimeStreamConsumer(genuine)).toBe(prepared)
    expect(prepare).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
    await expect(genuine.next()).resolves.toEqual({ done: false, value: 'stream-business-value' })
  })

  it('[APS7-S9] ignores a copied facade publisher while genuine lifecycle events still reach subscribers', () => {
    /** The canonical owner supplies one genuine frozen outlet and its original publisher. */
    const { facade } = outlet()
    /** Every public callback and every vulnerable private publisher descriptor is copied. */
    const forged = copyAllDescriptors(facade)
    expect(readRuntimeOutletEvents(forged)).toBeUndefined()
    /** Genuine facade subscription remains the exact original publisher callback. */
    const events = readRuntimeOutletEvents(facade)
    expect(facade.on).toBe(events.on)
    expect(facade.watch).toBe(events.watch)
    /** Existing lifecycle subscribers receive the exact event, with no callback error. */
    const listener = vi.fn()
    const report = vi.fn()
    const release = facade.on(RuntimeEventName.ready, listener)
    /** This safe lifecycle fixture carries no native resource or trust input. */
    const event: IRuntimeEvent = {
      type: RuntimeEventName.ready,
      name: 'worker',
      instanceId: 'instance-1',
      generation: 1,
      timestamp: 0,
      clock: RuntimeQueryClock.scheduler
    }
    events.publish(event, report)
    expect(listener).toHaveBeenCalledExactlyOnceWith(event)
    expect(report).not.toHaveBeenCalled()
    release()
    events.close()
  })

  it('[APS7-S10] ignores copied connection receipts while genuine routing preserves the original Promise', async () => {
    /** Only this exact facade is registered with the original slot reader. */
    const { facade, connection, find, invoke, result } = outlet()
    /** The attacker copies all methods and private properties without registering another receipt. */
    const forged = copyAllDescriptors(facade)
    expect(readRuntimeOutletConnection(forged, 'worker')).toBeUndefined()
    expect(find).not.toHaveBeenCalled()
    expect(readRuntimeOutletConnection(facade, 'worker')).toBe(connection)
    expect(find).toHaveBeenCalledExactlyOnceWith('worker')
    /** Genuine sends retain the original Peer operation and caller options unchanged. */
    const options = { timeoutMs: 100 }
    expect(facade.request('worker', 'work', null, options)).toBe(result)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('work', null, options)
    await expect(result).resolves.toBe('peer-business-value')
    find.mockReturnValueOnce(null)
    expect(readRuntimeOutletConnection(facade, 'worker')).toBeNull()
    find.mockReturnValueOnce(undefined)
    expect(readRuntimeOutletConnection(facade, 'worker')).toBeUndefined()
  })
})
