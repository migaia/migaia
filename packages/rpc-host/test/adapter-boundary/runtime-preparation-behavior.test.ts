import { EventEmitter } from 'node:events'
import { assert, describe, expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import {
  acceptRpcHandshake,
  RpcCapability,
  RpcCodecId,
  RpcProtocol,
  type IRpcHandshakeOffer
} from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { holdAdapterLaunch } from '../../dist/runtime-adapter/peer.js'
import { createAdapterBindingDrain } from '../../dist/runtime-adapter/binding.js'
import { createRuntimeProviderScope } from '../../dist/runtime-adapter/provider/scope.js'
import { createRuntimeProviderGovernor } from '../../dist/runtime-adapter/provider/governor.js'
import { createEventEmitterMessageResource } from '../../dist/runtime-adapter/message/resource.js'
import { type IAdapterListenerService } from '../../dist/runtime-adapter/listener.js'
import { type IRuntimeConnectionOptions } from '../../dist/runtime-adapter/byte/types.js'
import { prepareAdapterPeer } from '../../dist/runtime-adapter/peer.js'
import { holdAdapterObjectChannel } from '../../dist/runtime-adapter/object/connection.js'
import type { IRuntimeObjectIO } from '../../dist/runtime-adapter/object/types.js'
import type { IAdapterListenerOwner } from '../../dist/runtime-adapter/listener.js'
import { readAdapterBindingDrain } from '../../dist/runtime-adapter/binding.js'
import { readRuntimeProviderScope } from '../../dist/runtime-adapter/provider/scope.js'
import { withRuntimePreparationContext } from '../../dist/remote/runtime-api/launch-context.js'
import { RemoteMethodName } from '../../dist/remote/constants.js'
import { RpcPlatform } from '../../dist/core/transport-constants.js'
import type { IRuntimePeerOptions } from '../../dist/remote/runtime-api/peer.js'
import { remoteHarness } from '../remote/fixture.js'

/** Construct held object I/O whose reply still passes the canonical correlated handshake grammar. */
function objectFixture(codec: string = RpcCodecId.json) {
  return new ObjectFixture(codec)
}

/** One held object resource owns physical closing and original correlated negotiation observations. */
class ObjectFixture {
  /** The same native offer is admitted before any physical exchange occurs. */
  readonly offer: IRpcHandshakeOffer
  /** Original responder readiness is a distinct correlated result, never a guessed agreement. */
  readonly #reply = deferred<string>()
  /** Physical raw close keeps its original exact Promise identity. */
  readonly closing = Promise.resolve()
  /** Native revocation callbacks retain original Set delivery and removal semantics. */
  readonly #closingObservers = new Set<() => void>()
  /** Only the controlled physical close changes this original resource fact. */
  #closed = false
  /** Only the original serialized hello reaches canonical handshake admission. */
  readonly exchange = vi.fn((hello: string) => {
    /** The responder independently processes the same physical local hello. */
    const accepted = acceptRpcHandshake(
      { ...this.offer, peer: { id: 'peer', runtime: 'fixture' } },
      hello
    )
    assert(accepted.ok)
    this.#reply.resolve(accepted.reply)
    return this.#reply.promise
  })
  /** Actual activation remains independently observable after native negotiation succeeds. */
  readonly activate = vi.fn()
  /** Closing invokes the same original observers and returns the original physical Promise. */
  readonly close = vi.fn((_reason?: unknown) => {
    this.#closed = true
    for (const observer of this.#closingObservers) observer()
    return this.closing
  })
  /** Own native-shaped I/O getters preserve the held resource boundary and receiver behavior. */
  readonly io: IRuntimeObjectIO
  /** Original default-scheduler opening inputs remain an ordinary unprepared option record. */
  readonly options: IRuntimeConnectionOptions

  /** Capture original codec selection and construct the same cold raw I/O operations. */
  constructor(codec: string) {
    this.offer = {
      versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
      /** JSON remains mandatory while this original fixed optional codec keeps preference order. */
      codecs: [...new Set([codec, RpcCodecId.json])],
      capabilities: [],
      peer: { id: 'local', runtime: 'fixture' }
    }
    this.io = ObjectFixture.#view(this)
    this.options = {
      platform: RpcPlatform.memory,
      expectedStringText: 'fixture requires text',
      peerId: 'peer',
      report: vi.fn(),
      ipc: { connectionId: 'object-fixture', sessionId: 'object-session', log: () => undefined }
    }
  }
  /** Preserve the original own plain I/O view while mutable state belongs to one explicit owner. */
  static #view(owner: ObjectFixture): IRuntimeObjectIO {
    return {
      exchange: owner.exchange,
      activate: owner.activate,
      writeText: vi.fn(),
      writeObject: vi.fn(),
      subscribeText: () => () => undefined,
      subscribeObject: () => () => undefined,
      onTransportError: () => () => undefined,
      onClosing: (observer) => {
        owner.#closingObservers.add(observer)
        return () => {
          owner.#closingObservers.delete(observer)
        }
      },
      close: owner.close,
      assertOpen: () => {
        expect(owner.#closed).toBe(false)
      },
      get closed() {
        return owner.#closed
      }
    }
  }
}

describe('held object channel sequencing and retirement', () => {
  it('refuses exchange/open before admission and retains the first raw close reason', async () => {
    /** This held resource has no prepared offer or accepted handshake. */
    const fixture = objectFixture()
    /** Construction exposes operations while keeping actual I/O cold. */
    const connection = holdAdapterObjectChannel(fixture.io)
    expect(() => connection.negotiate()).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(() => connection.open(fixture.options)).toThrow(TypeError)
    expect(() => connection.open(fixture.options)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(fixture.exchange).not.toHaveBeenCalled()
    expect(fixture.activate).not.toHaveBeenCalled()
    /** Later callers cannot replace the first physical retirement reason. */
    const reason = { closed: 'first-request' }
    expect(connection.close(reason)).toBe(fixture.closing)
    expect(connection.close({ closed: 'later-request' })).toBe(fixture.closing)
    expect(fixture.close).toHaveBeenNthCalledWith(1, reason)
    expect(fixture.close).toHaveBeenNthCalledWith(2, reason)
    await fixture.closing
  })

  it('shares one negotiation Promise and rejects replacing an in-flight local offer', async () => {
    /** The real peer reply passes the common handshake grammar before activation. */
    const fixture = objectFixture()
    /** Only this held connection retains its prepared offer and published negotiation operation. */
    const connection = holdAdapterObjectChannel(fixture.io)
    connection.prepare(fixture.offer)
    /** Repeated consumers join the original exchange while proposal replacement remains forbidden. */
    const negotiating = connection.negotiate()
    expect(connection.negotiate()).toBe(negotiating)
    expect(() => connection.prepare(fixture.offer)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    await negotiating
    expect(fixture.exchange).toHaveBeenCalledOnce()
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith([])
    await connection.close()
  })

  it('rejects an accepted non-JSON codec before activating the held object resource', async () => {
    /** A syntactically valid offered codec can negotiate but cannot supply this JSON object carrier. */
    const fixture = objectFixture('fixture-codec')
    /** The actual exchange still passes canonical handshake admission before the carrier rejects it. */
    const connection = holdAdapterObjectChannel(fixture.io)
    connection.prepare(fixture.offer)
    /** Native TypeError/code remain the public carrier configuration refusal. */
    const negotiating = connection.negotiate()
    await expect(negotiating).rejects.toBeInstanceOf(TypeError)
    await expect(negotiating).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(fixture.exchange).toHaveBeenCalledOnce()
    expect(fixture.activate).not.toHaveBeenCalled()
    await connection.close()
  })

  it('reuses its opened channel, default scheduler and diagnostic close Promise', async () => {
    /** Genuine JSON negotiation supplies the one internally retained accepted agreement. */
    const fixture = objectFixture()
    /** The held owner constructs its transport only after the actual peer reply completes. */
    const connection = holdAdapterObjectChannel(fixture.io)
    connection.prepare(fixture.offer)
    await connection.negotiate()
    /** A repeated open keeps the exact channel and its original scheduler rather than rebuilding it. */
    const channel = connection.open(fixture.options)
    expect(connection.open(fixture.options)).toBe(channel)
    expect(channel.scheduler).toBe(systemScheduler)
    expect(channel.agreement.codec).toBe(RpcCodecId.json)
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith([])
    /** Diagnostic teardown and all channel facades join the same physical close settlement. */
    const closing = connection.close('first-close')
    expect(connection.close('ignored-close')).toBe(closing)
    expect(channel.close()).toBe(closing)
    await closing
    expect(fixture.close).toHaveBeenCalledExactlyOnceWith('first-close')
    expect(channel.transport.closed).toBe(true)
  })
})

/** One accepted raw message channel permits genuine listener preparation without platform launch. */
async function listenerFixture() {
  /** Native event subscription remains owned by this fixture's actual raw message source. */
  const events = new EventEmitter()
  /** Monotonic fixture time belongs to the existing resource deadlines and idle policy. */
  const scheduler = createManualScheduler()
  /** Only this Core-created held resource owns capture, control admission and channel retirement. */
  const resource = createEventEmitterMessageResource({
    postMessage: () => undefined,
    on: (event, listener) => {
      events.on(event, listener)
    },
    off: (event, listener) => {
      events.off(event, listener)
    }
  })
  /** Actual inbound control supplies principal identity; descriptive channel copies supply none. */
  const capabilities = [RpcCapability.runtimeApi, RpcCapability.batch, RpcCapability.stream]
  await resource.receiveInitial({
    direction: 'inbound',
    read: () => ({
      kind: rpcMessageCapabilityControl.data,
      peerId: 'listener-1',
      runtimeApi: {
        version: 1,
        self: { name: 'listener', instanceId: 'listener-1' },
        parent: { name: 'parent', instanceId: 'parent-1' },
        capabilities
      }
    })
  })
  await resource.prepareControl(capabilities)
  /** This exact channel comes from admitted raw control and retains its physical resource identity. */
  const channel = await resource.open({
    peerId: 'parent-1',
    scheduler,
    offer: capabilities,
    control: rpcMessageCapabilityControl
  })
  /** Reuse the existing borrowed endpoint seam and its original disposal observations. */
  const fixture = remoteHarness()
  /** The borrowed endpoint returns an accepted directory or observable business value by method. */
  const send = vi.fn(async (_target: string, method: string) =>
    method === RemoteMethodName.runtimeDescribe
      ? {
          schemaVersion: 2,
          self: { name: 'parent', instanceId: 'parent-1' },
          methods: [{ name: 'echo', supportedModes: ['request'], modeSource: 'declared' }]
        }
      : 'listener-business-value'
  )
  /** The existing borrowed endpoint seam supplies real callable operations to the listener session. */
  const served = {
    ...fixture.served,
    endpoint: {
      ...fixture.served.endpoint,
      send,
      provide: vi.fn()
    } as typeof fixture.served.endpoint
  }
  /** Observe construction of the one endpoint retained across prepare and attach calls. */
  const endpointFactory = vi.fn(async () => served)
  /** Record original secondary failures without changing the primary operation outcome. */
  const report = vi.fn()
  /** Local configuration supplies source policy without asserting accepted resource provenance. */
  const options: IRuntimePeerOptions = {
    self: { name: 'listener', instanceId: 'listener-1' },
    provide: {},
    report,
    endpointFactory
  }
  /** The canonical scope owns one original admission resource and shared idempotency store. */
  const scope = createRuntimeProviderScope()
  /** This genuine preparation owns service creation while native membership stays with its owner. */
  const listener = prepareAdapterPeer(options, 'listener').listener(capabilities)
  /** The original session retains its endpoint and Peer across concurrent preparation consumers. */
  const session = listener.session(channel, new AbortController().signal, scope, {})
  /** The canonical drain keeps physical-generation lifetime separate from the listener facade. */
  const drain = createAdapterBindingDrain(scheduler, report)
  /** The exact channel governor owns provider quotas and its native activity subscription. */
  const governor = createRuntimeProviderGovernor(
    channel,
    {
      maxCallsPerMinute: 100,
      maxPayloadBytes: 1024,
      maxConsecutiveTimeouts: 3,
      idleTimeoutMs: 1000,
      violationLimit: 3,
      overflow: { source: 'fixture', code: 'OVERFLOW', message: 'fixture overflow' }
    },
    async () => undefined,
    report
  )
  return {
    resource,
    channel,
    fixture,
    served,
    send,
    endpointFactory,
    scope,
    listener,
    session,
    drain,
    governor,
    scheduler,
    report
  }
}

describe('runtime adapter source preparation operations', () => {
  it.each(['selected', 'explicit', 'defaulted'] as const)(
    'gives %s local identity its established precedence and reuses its compiled context',
    async (kind) => {
      /** Explicit caller identity must keep precedence over adapter-selected local defaults. */
      const explicit = { name: 'explicit', instanceId: 'explicit-1' }
      /** The adapter-selected identity applies only when caller identity has not taken precedence. */
      const selected = { name: 'selected', instanceId: 'selected-1' }
      /** Local configuration supplies source policy without asserting accepted resource provenance. */
      const options = {
        ...(kind === 'selected' ? {} : { self: explicit }),
        provide: {},
        report: vi.fn()
      }
      await withRuntimePreparationContext(
        options,
        { selfDefaulted: kind === 'defaulted' },
        async () => {
          /** One Core preparation owns compiled local roots and any original Host context. */
          const preparation = prepareAdapterPeer(options, 'fallback', selected)
          expect(preparation.context.self).toEqual(kind === 'explicit' ? explicit : selected)
          expect(preparation.context).toBe(preparation.context)
        }
      )
    }
  )

  it.each(['wrongPeer', 'unsupportedCapability'] as const)(
    'rejects %s offers before invoking any resource factory',
    (kind) => {
      /** One Core preparation owns compiled local roots and any original Host context. */
      const preparation = prepareAdapterPeer(
        { self: { name: 'local', instanceId: 'local-1' }, report: vi.fn() },
        'local'
      )
      /** This local proposal exercises identity or capability refusal before native acquisition. */
      const offer: IRpcHandshakeOffer = {
        versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
        codecs: [RpcCodecId.json],
        capabilities: kind === 'unsupportedCapability' ? ['unknown@1'] : [],
        peer: { id: kind === 'wrongPeer' ? 'wrong-1' : 'local-1', runtime: 'fixture' }
      }
      expect(() => preparation.validateOffer(offer)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
    }
  )

  it.each([undefined, 'child-label'])(
    'retains actual launch request metadata for child name %s and removes it after launch',
    async (childName) => {
      /** One Core preparation owns compiled local roots and any original Host context. */
      const preparation = prepareAdapterPeer(
        { self: { name: 'local', instanceId: 'local-1' }, report: vi.fn() },
        'local'
      )
      /** Only this actual supervisor request carries Core launch metadata during the native call. */
      const request = { executionGeneration: 3 }
      /** The launcher returns this original native result without rebuilding it through preparation. */
      const unit = { native: 'unit' }
      /** The native launcher reads custody from its actual request and returns the original unit. */
      const launch = vi.fn(async (_spec: string, actual: typeof request) => {
        /** The held launch exposes metadata only while the canonical owner retains this request. */
        const proposal = holdAdapterLaunch(actual).proposal!
        expect(proposal.self.instanceId).toBe('local-1')
        expect(proposal.generation?.value).toBe(3)
        expect(proposal.childName).toBe(childName)
        expect(holdAdapterLaunch({ ...actual }).proposal).toBeUndefined()
        return unit
      })
      await expect(preparation.launch({ launch }, 'spec', request, childName)).resolves.toBe(unit)
      expect(launch).toHaveBeenCalledExactlyOnceWith('spec', request)
      expect(holdAdapterLaunch(request).proposal).toBeUndefined()
    }
  )

  it('narrowed views retain real signals, ownership and providers without recreating preparation', async () => {
    /** The original startup signal stays attached to this preparation through narrowing. */
    const initial = new AbortController().signal
    /** The Host shutdown signal keeps its original identity on every narrowing view. */
    const lifecycle = new AbortController().signal
    /** Current Host providers are retained by their existing preparation operation. */
    const provide = { echo: () => 'original-provider' }
    /** Observe registration of the original resource disposer with its owning Host operation. */
    const own = vi.fn()
    /** Observe resource retirement separately from facade construction and ownership selection. */
    const close = vi.fn(async () => undefined)
    /** Local configuration supplies source policy without asserting accepted resource provenance. */
    const options = { self: { name: 'local', instanceId: 'local-1' }, report: vi.fn() }
    await withRuntimePreparationContext(
      options,
      { initialSignal: initial, lifecycleSignal: lifecycle, own, readProvide: () => provide },
      async () => {
        /** One Core preparation owns compiled local roots and any original Host context. */
        const preparation = prepareAdapterPeer(options, 'local')
        /**
         * This cached view changes transfer policy while sharing original context and resource
         * owners.
         */
        const narrowed = preparation.withoutTransfer()
        expect(preparation.withoutTransfer()).toBe(narrowed)
        expect(narrowed.withoutTransfer()).toBe(narrowed)
        expect(narrowed.context).toBe(preparation.context)
        expect(narrowed.initialSignal).toBe(initial)
        expect(narrowed.lifecycleSignal).toBe(lifecycle)
        expect(narrowed.readProvide({})).toBe(provide)
        narrowed.own({ close })
        await own.mock.calls[0]![0]()
        expect(close).toHaveBeenCalledOnce()
      }
    )
  })

  it('an unowned narrowed view preserves fallback providers without closing borrowed resources', () => {
    /** This cached view changes transfer policy while sharing original context and resource owners. */
    const narrowed = prepareAdapterPeer({ report: vi.fn() }, 'local').withoutTransfer()
    /** Ordinary local providers remain available when no Host snapshot owns their selection. */
    const fallback = { echo: () => 'fallback' }
    /** Observe resource retirement separately from facade construction and ownership selection. */
    const close = vi.fn(async () => undefined)
    expect(narrowed.readProvide(fallback)).toBe(fallback)
    narrowed.own({ close })
    expect(close).not.toHaveBeenCalled()
    expect(narrowed.initialSignal).toBeUndefined()
    expect(narrowed.lifecycleSignal).toBeUndefined()
  })

  it('rejects a copied message resource before calling its acquisition operations', async () => {
    /** Only this canonical held resource can supply initial-capture preparation provenance. */
    const genuine = createEventEmitterMessageResource({
      postMessage: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    })
    /** A foreign copy must be rejected before its caller-selected acquisition operation runs. */
    const receiveInitial = vi.fn()
    /** Matching public fields cannot transfer the original resource construction identity. */
    const foreign = { ...genuine, receiveInitial } as typeof genuine
    /** Local configuration supplies source policy without asserting accepted resource provenance. */
    const options = { report: vi.fn() }
    await expect(prepareAdapterPeer(options, 'local').peer(options, foreign)).rejects.toMatchObject(
      { code: 'INVALID_CONFIG' }
    )
    expect(receiveInitial).not.toHaveBeenCalled()
    await genuine.close()
  })

  it.each(['name', 'instanceId'] as const)(
    'refuses an automatic resource %s mismatch and removes its initial capture',
    async (field) => {
      /** The actual raw initial receiver supplies Core's admitted child identity. */
      const events = new EventEmitter()
      /**
       * Only this Core-created held resource owns capture, control admission and channel
       * retirement.
       */
      const resource = createEventEmitterMessageResource({
        postMessage: vi.fn(),
        on: (event, listener) => {
          events.on(event, listener)
        },
        off: (event, listener) => {
          events.off(event, listener)
        }
      })
      /** The original initial-read Promise retains admission result and native failure identity. */
      const receiving = resource.receiveInitial()
      events.emit('message', {
        kind: rpcMessageCapabilityControl.data,
        peerId: 'child-1',
        runtimeApi: {
          version: 1,
          self: { name: 'child', instanceId: 'child-1' },
          parent: { name: 'parent', instanceId: 'parent-1' },
          capabilities: []
        }
      })
      await receiving
      /** Explicit user identity cannot replace the different child observed on this resource. */
      const options = {
        self: {
          name: field === 'name' ? 'wrong' : 'child',
          instanceId: field === 'instanceId' ? 'wrong-1' : 'child-1'
        },
        report: vi.fn()
      }
      await expect(
        prepareAdapterPeer(options, 'child').peer(options, resource)
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      expect(events.listenerCount('message')).toBe(0)
      expect(events.listenerCount('messageerror')).toBe(0)
      await resource.close()
    }
  )
})

describe('listener resource custody and selection', () => {
  it('refuses copied operations, missing preparation and another connection governor', async () => {
    /** The fixture keeps the accepted channel, session, scope and cleanup operations together. */
    const owner = await listenerFixture()
    try {
      /** Method transplantation must fail before using another receiver as this listener owner. */
      const copied = { ...owner.listener }
      expect(() =>
        copied.session(owner.channel, new AbortController().signal, owner.scope, {})
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
      expect(() => copied.open({} as IAdapterListenerOwner)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() => copied.publish({} as IAdapterListenerService)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() =>
        owner.listener.session({ ...owner.channel }, new AbortController().signal, owner.scope, {})
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
      expect(() =>
        owner.listener.session(owner.channel, new AbortController().signal, { ...owner.scope }, {})
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
      expect(() => owner.session.attach(owner.drain, owner.governor)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() => owner.session.peer()).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      /** Concurrent preparation consumers must join this original endpoint construction Promise. */
      const preparing = owner.session.prepare()
      expect(owner.session.prepare()).toBe(preparing)
      await expect(preparing).resolves.toBe(owner.served)
      expect(owner.endpointFactory).toHaveBeenCalledOnce()
      /** Reflected session methods do not transfer the original closure and receiver custody. */
      const copiedSession = { ...owner.session }
      expect(() => copiedSession.prepare()).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() => copiedSession.attach(owner.drain, owner.governor)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() => copiedSession.peer()).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() => owner.session.attach({ ...owner.drain }, owner.governor)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(() => owner.session.attach(owner.drain, { ...owner.governor })).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      expect(readAdapterBindingDrain(owner.drain)).toBe(owner.drain)
      expect(readAdapterBindingDrain({ ...owner.drain })).toBeUndefined()
      expect(readRuntimeProviderScope(owner.scope)).toBe(owner.scope)
      expect(readRuntimeProviderScope({ ...owner.scope })).toBeUndefined()
    } finally {
      owner.governor.close()
      owner.scope.close()
      await owner.resource.close()
    }
  })

  it.each(['absent', 'ambiguous', 'foreign'] as const)(
    'refuses %s current services before request/notify/stream/group/outcome dispatch',
    (kind) => {
      /** Local configuration supplies source policy without asserting accepted resource provenance. */
      const options = { self: { name: 'local', instanceId: 'local-1' }, report: vi.fn() }
      /**
       * This genuine preparation owns service creation while native membership stays with its
       * owner.
       */
      const listener = prepareAdapterPeer(options, 'local').listener([])
      /** The original owner coalesces its actual close operation before facade forwarding. */
      const closingPromise = Promise.resolve()
      /** Observe resource retirement separately from facade construction and ownership selection. */
      const close = vi.fn(() => closingPromise)
      /** The fixture keeps the accepted channel, session, scope and cleanup operations together. */
      const owner: IAdapterListenerOwner = {
        carrier: 'fixture',
        current: () =>
          kind === 'absent'
            ? undefined
            : kind === 'ambiguous'
              ? null
              : ({} as IAdapterListenerService),
        services: () => [],
        closed: () => false,
        close
      }
      /** This facade routes through native membership rather than retaining another service index. */
      const peer = listener.open(owner)
      /**
       * The expected refusal identifies absence, ambiguity or foreign service provenance
       * distinctly.
       */
      const code =
        kind === 'absent'
          ? 'TARGET_UNKNOWN'
          : kind === 'ambiguous'
            ? 'CAPABILITY_CONFLICT'
            : 'INVALID_CONFIG'
      for (const operation of [
        () => peer.request('echo'),
        () => peer.notify('echo'),
        () => peer.stream('echo'),
        () => peer.group([]),
        () => peer.outcome('key')
      ])
        expect(operation).toThrow(expect.objectContaining({ code }))
      /** Retirement must preserve the original owner Promise rather than allocate another close. */
      const closing = peer.close()
      expect(peer.close()).toBe(closing)
      expect(close).toHaveBeenCalledTimes(2)
    }
  )

  it.each([false, true])(
    'empty listener descriptions reflect native closed=%s without inventing sessions',
    async (closed) => {
      /** Local configuration supplies source policy without asserting accepted resource provenance. */
      const options = { self: { name: 'local', instanceId: 'local-1' }, report: vi.fn() }
      /** A genuine publication owner must reject foreign services before acquiring their peer. */
      const publishPeer = vi.fn(() => () => undefined)
      await withRuntimePreparationContext(options, { publishPeer }, async () => {
        /**
         * This genuine preparation owns service creation while native membership stays with its
         * owner.
         */
        const listener = prepareAdapterPeer(options, 'local').listener([])
        /** This facade routes through native membership rather than retaining another service index. */
        const peer = listener.open({
          carrier: 'fixture',
          current: () => undefined,
          services: () => [],
          closed: () => closed,
          close: async () => undefined
        })
        /**
         * Description output reflects actual membership or native closure without inventing
         * connections.
         */
        const detail = await peer.describe()
        expect(detail.connections).toHaveLength(1)
        expect(detail.connections[0]!.connection.status).toBe(closed ? 'closed' : 'ready')
        expect(() => listener.publish({} as IAdapterListenerService)).toThrow(
          expect.objectContaining({ code: 'INVALID_CONFIG' })
        )
        expect(publishPeer).not.toHaveBeenCalled()
      })
    }
  )

  it('genuine session attachment and peering join one resource and retain original close Promise', async () => {
    /** The fixture keeps the accepted channel, session, scope and cleanup operations together. */
    const owner = await listenerFixture()
    try {
      await owner.session.prepare()
      /**
       * Canonical drain and governor attachment must return the same final endpoint on repeated
       * calls.
       */
      const attached = owner.session.attach(owner.drain, owner.governor)
      expect(owner.session.attach(owner.drain, owner.governor)).toBe(attached)
      /** Concurrent service readers must join one actual Peer preparation operation. */
      const peering = owner.session.peer()
      expect(owner.session.peer()).toBe(peering)
      /** Only this canonically created service can be selected or published by the listener. */
      const service = await peering
      expect(service.close).toBe(service.peer.close)
      await expect(service.peer.request('echo')).resolves.toBe('listener-business-value')
      /** Observe resource retirement separately from facade construction and ownership selection. */
      const close = vi.fn(() => Promise.resolve())
      /** This facade routes through native membership rather than retaining another service index. */
      const peer = owner.listener.open({
        carrier: 'fixture',
        current: () => service,
        services: () => [service],
        closed: () => false,
        close
      })
      await expect(peer.request('echo')).resolves.toBe('listener-business-value')
      /**
       * Description output reflects actual membership or native closure without inventing
       * connections.
       */
      const detail = await peer.describe()
      expect(detail.connections).toHaveLength(1)
      expect(detail.connections[0]!.identity).toMatchObject({
        name: 'parent',
        instanceId: 'parent-1'
      })
      expect(typeof owner.listener.publish(service)).toBe('function')
      await service.close()
      expect(owner.fixture.calls).toContain('endpoint.dispose')
    } finally {
      owner.governor.close()
      owner.scope.close()
      await owner.resource.close()
    }
  })
})

describe('adapter registration and provider scope policies', () => {
  it('reports one rejected observer while preserving the other observer and selected invalid limits', async () => {
    /** The fixture keeps the accepted channel, session, scope and cleanup operations together. */
    const owner = await listenerFixture()
    try {
      /** Two distinct configured observers retain their own original refusal callback ownership. */
      const failure = { observer: 'failed' }
      /** The first configured observer deliberately rejects to exercise secondary failure reporting. */
      const first = vi.fn(async () => {
        throw failure
      })
      /** The other configured observer must still receive refusal after its peer callback fails. */
      const second = vi.fn()
      /** Selected limits preserve the existing narrowing and invalid-input handoff contract. */
      const limits = owner.governor.limits(
        { maxGlobal: 10, maxPerPeer: 5, onRejected: first },
        { maxGlobal: 0, maxPerPeer: 3, onRejected: second }
      )
      expect(limits.maxGlobal).toBe(0)
      expect(limits.maxPerPeer).toBe(3)
      /** Replay refusal is reported to both observers without turning into a concurrency violation. */
      const notice = {
        verifiedPeerKey: 'peer',
        controllerKey: 'controller',
        method: 'echo',
        reason: 'replayLedgerFull' as const
      }
      await limits.onRejected!(notice)
      expect(first).toHaveBeenCalledExactlyOnceWith(notice)
      expect(second).toHaveBeenCalledExactlyOnceWith(notice)
      expect(owner.report).toHaveBeenCalledExactlyOnceWith(failure)
      owner.governor.close()
      owner.governor.close()
      expect(owner.report).toHaveBeenCalledOnce()
    } finally {
      owner.governor.close()
      owner.scope.close()
      await owner.resource.close()
    }
  })

  it('retains a selected idempotency store and refuses unconstructed principal metadata', async () => {
    /** The fixture keeps the accepted channel, session, scope and cleanup operations together. */
    const owner = await listenerFixture()
    try {
      /** This original session exposes the default store selected for the later custom scope. */
      const first = owner.scope.session(owner.channel, {})
      /**
       * This independent scope reuses the caller-selected existing store without copying principal
       * custody.
       */
      const selected = createRuntimeProviderScope(first.idempotency.store)
      /** Selected limits preserve the existing narrowing and invalid-input handoff contract. */
      const limits = { maxGlobal: 3 }
      /** Derive this scope's idempotency policy from the same genuine connection and chosen limits. */
      const session = selected.session(owner.channel, limits)
      expect(session.idempotency.store).toBe(first.idempotency.store)
      expect(session.limits).toBe(limits)
      expect(() => selected.session({ ...owner.channel }, limits)).toThrow(TypeError)
      expect(() => selected.session({ ...owner.channel }, limits)).toThrow(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      selected.close()
    } finally {
      owner.governor.close()
      owner.scope.close()
      await owner.resource.close()
    }
  })
})
