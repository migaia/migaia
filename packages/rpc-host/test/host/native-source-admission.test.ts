/** Genuine native source transactions share a cold namespace without exposing pending peers. */
import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import {
  defineRpcSourcePlugin,
  defineTransportPlugin,
  rpcHostPipelines
} from '@migaia/rpc-host/sdk'
import { RpcWireKind } from '@migaia/rpc-contract/protocol'
import { expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** The functional native Host lends its real owner only after cold declarations are constructed. */
function nativeSourceHost() {
  /** This fixed map is independent of every later source registration name. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['shared']
  )
  /** Actual native transactions own Features, source commit and rollback. */
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name: 'source-native' },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      diagnostic: () => undefined
    }
  })
  return host
}

/** One concrete source fixture owns only original native endpoints and installation barriers. */
class SourceAdmissionFixture {
  /** Public native owner remains usable after one appended source rolls back. */
  readonly native = nativeSourceHost()
  /** The actual provider must remain untouched until the source transaction commits. */
  readonly echo = vi.fn((value: unknown) => value)
  /** The original source installation disposer is observable independently from Session removal. */
  readonly dispose = vi.fn()
  /** A later native install fails with this exact original primary. */
  readonly primary = new Error('source transaction primary')
  /** Pending source readiness is genuine bilateral Session readiness. */
  readonly entered = deferred<void>()
  /** Only native source installation is held; frames and cancel/control continue normally. */
  readonly release = deferred<void>()
  /** Physical endpoints are the existing carrier fixture, with no admission or reader wrapper. */
  readonly left = new MemoryCarrier('source-native-left')
  /** Remote public writes remain observable at their original physical boundary. */
  readonly right = new MemoryCarrier('source-native-right')
  /** The remote has its own genuine public Host and native transport owner. */
  client: Readonly<{ close(reason?: unknown): Promise<void>; shared: IRpcNamespace }> | undefined
  /** The original native transaction result retains either its success or exact install failure. */
  installing: Promise<unknown> | undefined

  /** Link the original native endpoints before either side subscribes. */
  constructor() {
    this.left.link(this.right)
    this.right.link(this.left)
    /** MemoryCarrier deliberately drops writes before subscribe; hold its real IO until both attach. */
    this.left.holdWrites()
  }

  /** Install the cold namespace first, then acquire a real late source in its own native batch. */
  async start(rollback: boolean): Promise<void> {
    await this.native.use(
      definePlugin({
        name: 'app',
        features: { api: defineFeature(() => ({ echo: this.echo })) },
        install: () => ({})
      })
    )
    await this.native.use(
      defineTransportPlugin({
        name: 'shared-namespace',
        namespace: 'shared',
        expose: ['app'],
        open: () => ({ dispose: () => undefined })
      })
    )
    /**
     * The concrete original definition owns attach and readiness; source admission only lends
     * scope.
     */
    const source = defineTransportPlugin({
      name: 'late-source',
      namespace: 'source-controls',
      expose: ['app'],
      open: async (context) => {
        await context.attach(this.left).ready
        this.entered.resolve()
        await this.release.promise
        return { namespaceExtensions: { receipt: this.primary }, dispose: this.dispose }
      }
    })
    /** No synthetic commit call is used; the later real native hook decides the batch outcome. */
    const after = rollback
      ? [
          definePlugin({
            name: 'source-later-failure',
            install: () => {
              throw this.primary
            }
          })
        ]
      : []
    this.installing = this.native.use(defineRpcSourcePlugin(source, 'shared'), ...after).then(
      () => undefined,
      (error: unknown) => error
    )
    this.client = await createRpcHost({
      self: { name: 'source-peer', instanceId: 'source-peer' },
      report: () => undefined,
      plugins: [
        defineTransportPlugin({
          name: 'source-client',
          namespace: 'shared',
          open: async (context) => {
            /** Both original receivers subscribe before the held native hello can be delivered. */
            const connected = context.attach(this.right)
            this.left.releaseWrites()
            await connected.ready
            return { dispose: () => undefined }
          }
        })
      ]
    })
    await this.entered.promise
  }

  /** All business calls use the existing namespace published by their actual owner. */
  get namespace(): IRpcNamespace {
    return Reflect.get(this.native, 'shared') as IRpcNamespace
  }
  /** The client publishes its own route independently from the uncommitted parent source. */
  get remote(): IRpcNamespace {
    return this.client!.shared
  }

  /** Wait for this fixture's real public call to reach the original physical write boundary. */
  async waitForCall(payload: string): Promise<void> {
    await vi.waitFor(() =>
      expect(
        this.right.written.some(
          (frame) => frame.kind === RpcWireKind.call && frame.payload === payload
        )
      ).toBe(true)
    )
  }

  /** A public cancel must receive its real remote terminal while native source commit is still held. */
  async cancelPending(): Promise<void> {
    /** This exact reason remains on the caller's original cancellation failure. */
    const reason = new Error('cancel pending source call')
    /** The real public signal drives CallTable's original cancellation frame. */
    const controller = new AbortController()
    /** This actual request must remain tracked while its source gate is not committed. */
    const pending = this.remote.send('source-native', 'app.echo', 'cancelled', {
      signal: controller.signal
    })
    /** Attach the expected original failure before cancellation can settle its Promise. */
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED', cause: reason })
    await this.waitForCall('cancelled')
    /** Native written records identify the actual operation whose remote terminal must arrive. */
    const call = this.right.written.find(
      (frame) => frame.kind === RpcWireKind.call && frame.payload === 'cancelled'
    )!
    /** This fixed fixture has exactly one cancelled business call and therefore one original id. */
    const id =
      call.kind === RpcWireKind.call ? call.id : expect.unreachable('cancelled call missing')
    controller.abort(reason)
    await rejected
    await vi.waitFor(() =>
      expect(
        this.left.written.some((frame) => frame.kind === RpcWireKind.error && frame.id === id)
      ).toBe(true)
    )
    expect(
      this.right.written.some((frame) => frame.kind === RpcWireKind.cancel && frame.id === id)
    ).toBe(true)
    expect(this.echo).not.toHaveBeenCalled()
  }

  /** Release every original owner even if an assertion fails while the native source is held. */
  async close(): Promise<void> {
    this.release.resolve()
    await this.client?.close()
    await this.native.dispose()
    await this.installing
  }
}

it.each(['commit', 'rollback'] as const)(
  'keeps source publication atomic and cancel/control live through native %s',
  async (outcome) => {
    /** Both paths exercise the same actual native core, provider and physical source. */
    const fixture = new SourceAdmissionFixture()
    try {
      await fixture.start(outcome === 'rollback')
      /** This exact fixed namespace must survive either source transaction outcome. */
      const namespace = fixture.namespace
      expect(Object.keys(namespace.peers)).toEqual([])
      expect(Reflect.get(fixture.native, 'source-controls')).toBeUndefined()
      await fixture.cancelPending()
      /** A surviving call also reaches the real source before native commit is released. */
      const pending = fixture.remote.send('source-native', 'app.echo', 'survivor')
      /** Capture the real operation outcome without creating a replacement settlement policy. */
      const settled = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      await fixture.waitForCall('survivor')
      expect(fixture.echo).not.toHaveBeenCalled()
      fixture.release.resolve()
      /** Only the genuine native transaction decides commit or original rollback failure. */
      const installed = await fixture.installing
      if (outcome === 'commit') {
        expect(installed).toBeUndefined()
        expect(await settled).toEqual({ value: 'survivor' })
        expect(fixture.echo).toHaveBeenCalledExactlyOnceWith(
          'survivor',
          expect.objectContaining({ senderId: 'source-peer', data: 'survivor' })
        )
        expect(Object.keys(namespace.peers)).toEqual(['source-peer'])
        expect(Reflect.get(fixture.native, 'source-controls').receipt).toBe(fixture.primary)
        await fixture.native.unUse('late-source')
      } else {
        expect((installed as Error).cause).toBe(fixture.primary)
        expect(await settled).toMatchObject({ error: { code: 'TARGET_UNKNOWN' } })
        expect(fixture.echo).not.toHaveBeenCalled()
      }
      expect(fixture.namespace).toBe(namespace)
      expect(Object.keys(namespace.peers)).toEqual([])
      expect(Reflect.get(fixture.native, 'source-controls')).toBeUndefined()
      expect(fixture.dispose).toHaveBeenCalledTimes(1)
      expect(fixture.left.unsubscribed).toBe(1)
    } finally {
      await fixture.close()
    }
  }
)
