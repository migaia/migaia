import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from '@migaia/plugin-host'
import { createManualScheduler } from '@migaia/utils/scheduler'
import {
  RpcCapability,
  RpcCodecId,
  RpcProtocol,
  type IRpcHandshakeOffer
} from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import {
  prepareAdapterPeer,
  holdAdapterLaunch,
  createAdapterBindingDrain,
  createAdapterPlugin,
  createRuntimeProviderScope,
  createRuntimeProviderGovernor,
  createEventEmitterMessageResource,
  type IAdapterListenerOwner,
  type IAdapterListenerService
} from '../../dist/adapter.js'
import { readAdapterBindingDrain } from '../../dist/runtime-adapter/binding.js'
import { readRuntimeProviderScope } from '../../dist/runtime-adapter/provider/scope.js'
import { withRuntimePreparationContext } from '../../dist/remote/runtime-api/launch-context.js'
import { RemoteMethodName } from '../../dist/remote/constants.js'
import type { IRuntimePeerOptions } from '../../dist/remote/index.js'
import { remoteHarness, REMOTE_FIXTURE_CONTRACT } from '../remote/fixture.js'

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
    '[HC16] gives %s local identity its established precedence and reuses its compiled context',
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
    '[HC17] rejects %s offers before invoking any resource factory',
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
    '[HC18] retains actual launch request metadata for child name %s and removes it after launch',
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

  it('[HC19] narrowed views retain real signals, ownership and providers without recreating preparation', async () => {
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

  it('[HC20] an unowned narrowed view preserves fallback providers without closing borrowed resources', () => {
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

  it('[HC21] rejects a copied message resource before calling its acquisition operations', async () => {
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
    '[HC28] refuses an automatic resource %s mismatch and removes its initial capture',
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
  it('[HC22] refuses copied operations, missing preparation and another connection governor', async () => {
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
    '[HC23] refuses %s current services before request/notify/stream/group/outcome dispatch',
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
    '[HC24] empty listener descriptions reflect native closed=%s without inventing sessions',
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

  it('[HC25] genuine session attachment and peering join one resource and retain original close Promise', async () => {
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
  it('[HC29] reports one rejected observer while preserving the other observer and selected invalid limits', async () => {
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

  it.each(['none', 'installed', 'close', 'both'] as const)(
    '[HC26] retains %s lifecycle callbacks through actual PluginHost installation and disposal',
    async (kind) => {
      /**
       * Reuse existing endpoint and lifecycle observations rather than add another registration
       * seam.
       */
      const fixture = remoteHarness()
      /** Actual PluginHost installation and disposal own the tested lifecycle callback sequence. */
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** Observe the optional committed-install callback on the original adapter definition. */
      const installed = vi.fn(async () => undefined)
      /** Observe resource retirement separately from facade construction and ownership selection. */
      const close = vi.fn(async () => undefined)
      /** This trusted adapter definition transfers held binding behavior into PluginHost. */
      const definition = createAdapterPlugin(
        {
          name: 'p',
          contract: REMOTE_FIXTURE_CONTRACT,
          binding: fixture.binding,
          endpointFactory: async () => fixture.served,
          host: host.plugin,
          report: vi.fn()
        },
        { fixture: true },
        kind === 'none'
          ? undefined
          : {
              ...(kind === 'installed' || kind === 'both' ? { installed } : {}),
              ...(kind === 'close' || kind === 'both' ? { close } : {})
            }
      )
      expect(definition.fixture).toBe(true)
      try {
        await expect(host.use(definition)).resolves.toHaveLength(1)
        expect(installed).toHaveBeenCalledTimes(kind === 'installed' || kind === 'both' ? 1 : 0)
      } finally {
        await host.dispose()
      }
      expect(close).toHaveBeenCalledTimes(kind === 'close' || kind === 'both' ? 1 : 0)
      expect(fixture.calls).toContain('endpoint.dispose')
    }
  )

  it('[HC27] retains a selected idempotency store and refuses unconstructed principal metadata', async () => {
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
      /** The original session retains its endpoint and Peer across concurrent preparation consumers. */
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
