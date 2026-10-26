/** Original bootstrap business uses the current native first-frame owner and actual Host Sessions. */
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { createRpcHost, RpcWarningCode, type IRpcHost, type IRpcWarning } from '@migaia/rpc-host'
import { defineTransportPlugin, RpcEventByteIO, encodeRpcStreamFrame } from '@migaia/rpc-host/sdk'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { receiveAdapterBootstrap } from '../../dist/process/bootstrap.js'
import { serveProcessSessions } from '../../dist/process/plugin/serve.js'
import { createProcessCarrier } from '../../dist/process/carrier.js'
import { createProcessChannelClosedError } from '../../dist/process/error.js'
import { acceptProcessConnectionBootstrap } from '../../dist/process/connection-bootstrap.js'
import {
  PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  PROCESS_RUNTIME_API_BOOTSTRAP_VERSION
} from '../../dist/process/constants.js'

/** Native launch identity remains independent from the child's initially unassigned Host identity. */
const childSelf = { name: 'actual-child', instanceId: 'actual-child-instance' }
/** This real native first frame precedes the sole semantic RPC hello on the same byte stream. */
const bootstrap = {
  kind: PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  version: PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
  self: childSelf,
  parentInstanceId: 'actual-parent',
  token: 'fixture-token',
  generation: { kind: 'restart', value: 3, providerId: 'original-launch-owner' }
}

/** Two actual native streams borrow SDK byte ownership; this fixture adds no framing or IO queue. */
class NativeBootstrapFixture {
  /** The child's reader receives only bytes physically written by the parent's native writer. */
  readonly #towardChild = new PassThrough()
  /** The opposite native stream carries actual reverse calls and results. */
  readonly #towardParent = new PassThrough()
  /** Exact native cleanup failures remain visible at the original reporting boundary. */
  readonly reports: unknown[] = []
  /** The actual child bootstrap reader has subscribed before the parent may write its first frame. */
  readonly reading = deferred<void>()
  /** Acquisition of the real decoded first frame precedes its independently held return. */
  readonly received = deferred<void>()
  /** This controls only the original native acquisition return, never Session readiness. */
  readonly release = deferred<void>()
  /** The native reader may be reused immediately when the original case needs no preparation hold. */
  readonly #hold: boolean
  /** One original physical child release owns the original close-count assertion. */
  childCloses = 0
  /** A selected physical cleanup exception belongs to this exact acquired stream pair. */
  cleanupFailure: Error | undefined
  /** The actual parent's SDK byte owner retains its own stable close Promise. */
  readonly parentIO
  /** The actual child uses the same SDK owner as native Process stdio. */
  readonly childIO
  /** A genuine accepted Session supplies directory facts; no directory DTO is manufactured. */
  accepted: IRpcSessionView | undefined

  /** Prepare native streams without opening a Host, reading bootstrap or constructing a codec. */
  constructor(hold = false) {
    this.#hold = hold
    this.parentIO = new RpcEventByteIO(
      this.#towardParent,
      this.#towardChild,
      () => this.#destroy(),
      { closedError: createProcessChannelClosedError, report: this.#report }
    ).value
    this.childIO = new RpcEventByteIO(
      this.#towardChild,
      this.#towardParent,
      () => {
        this.childCloses++
        this.#destroy()
        if (this.cleanupFailure) throw this.cleanupFailure
      },
      { closedError: createProcessChannelClosedError, report: this.#report }
    ).value
  }

  /** The original Process rollback reporter observes exact native failures without replacing them. */
  readonly #report = (error: unknown): void => {
    this.reports.push(error)
  }

  /** Both streams are actual native resources; repeated destroy retains Node's own idempotency. */
  #destroy(): void {
    this.#towardChild.destroy()
    this.#towardParent.destroy()
  }

  /** The parent writes one original native record, then attaches the sole Process carrier. */
  readonly parent = defineTransportPlugin({
    name: 'bootstrap-parent',
    namespace: 'process',
    open: async (context) => {
      await this.parentIO.write(
        encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(bootstrap)))
      )
      /** The genuine native token gate precedes the separate semantic Session on these same bytes. */
      const admitted = await this.admit(context.signal)
      /** Session owns the one semantic handshake, accepted metadata and actual carrier lifetime. */
      const handle = context.attach(
        createProcessCarrier(admitted.channel, context, { id: 'parent' }),
        undefined,
        admitted.connectionContext
      )
      this.accepted = await handle.ready
      return { dispose: () => context.detach(handle) }
    }
  })

  /** Complete actual parent token admission without creating a semantic Session for mismatch cases. */
  admit(signal: IAbortSignal) {
    return acceptProcessConnectionBootstrap(
      this.parentIO,
      { token: bootstrap.token, expectedPeerId: childSelf.instanceId },
      { signal, report: this.#report }
    )
  }

  /** Child serve owns cancellation before its original native bootstrap acquisition can await. */
  readonly child = defineTransportPlugin({
    name: 'bootstrap-child',
    namespace: 'process',
    open: async (context) => {
      /** This actual native owner receives bootstrap, adopts source identity and attaches Session. */
      const serving = await serveProcessSessions(
        {
          kind: 'child',
          channelKind: 'byte',
          parentLoss: { exit: () => undefined },
          openRaw: this.#openChild
        },
        context,
        { report: this.#report }
      )
      return { dispose: serving.close }
    }
  })

  /** Decode the real first frame once; native discovery preserves any coalesced hello tail. */
  readonly #openChild = async () => {
    /** Construction subscribes synchronously to the actual paused native reader. */
    const opening = receiveAdapterBootstrap(this.childIO, 'stdin')
    this.reading.resolve()
    /** No returned bootstrap DTO can substitute for receiving the actual native stream bytes. */
    const received = await opening
    this.received.resolve()
    if (this.#hold) await this.release.promise
    return { raw: received.channel, bootstrap: received.bootstrap! }
  }

  /** Fixture rollback releases only its original native ports and observes both cleanup results. */
  async close(): Promise<void> {
    this.release.resolve()
    await Promise.allSettled([this.parentIO.close(), this.childIO.close()])
    this.#destroy()
  }
}

it('adopts the real first-frame self and generation and keeps bidirectional calls', async () => {
  /** Native acquisition stays pending until the original first-frame observation has occurred. */
  const fixture = new NativeBootstrapFixture(true)
  /** The actual child owns both original provider modes before its transport begins acquisition. */
  const childOpening = createRpcHost({
    plugins: [fixture.child],
    provide: {
      echo: (value: unknown) => value,
      async *values() {
        yield 1
        yield 2
      }
    },
    report: (error) => fixture.reports.push(error)
  })
  await fixture.reading.promise
  /** The original parent has one native identity and the same real reverse-call provider. */
  const parentOpening = createRpcHost({
    self: { name: 'parent', instanceId: 'actual-parent' },
    plugins: [fixture.parent],
    provide: { parent: () => 'reverse' },
    report: (error) => fixture.reports.push(error)
  })
  try {
    await fixture.received.promise
    fixture.release.resolve()
    /** Both original Host owners publish only after their actual native opening completes. */
    const [parentHost, childHost] = await Promise.all([parentOpening, childOpening])
    try {
      expect(childHost.self).toEqual(childSelf)
      expect(fixture.accepted).toMatchObject({
        name: childSelf.name,
        peerId: childSelf.instanceId,
        generation: bootstrap.generation
      })
      expect(await parentHost.process.send(childSelf.instanceId, 'echo', 42)).toBe(42)
      expect(await childHost.process.send('parent', 'parent')).toBe('reverse')
      /** The actual returned public stream supplies its original two provider values. */
      const values: unknown[] = []
      for await (const value of parentHost.process.stream('values') as AsyncIterable<unknown>)
        values.push(value)
      expect(values).toEqual([1, 2])
    } finally {
      await childHost.close()
      await parentHost.close()
    }
  } finally {
    fixture.release.resolve()
    await fixture.close()
  }
})

it('warns for an ignored explicit self and preserves cleanup failure reports', async () => {
  /** One native cleanup exception remains the exact original object in the report sink. */
  const cleanup = new Error('bootstrap native close failure')
  /** The original stream pair carries both native bootstrap and a genuine accepted Session. */
  const fixture = new NativeBootstrapFixture()
  fixture.cleanupFailure = cleanup
  /** BC14 replaces the old identity rejection with one warning on this same child Host. */
  const warnings: IRpcWarning[] = []
  /** Only actual completed public Hosts enter this original cleanup set. */
  const hosts: Pick<IRpcHost, 'close'>[] = []
  /** The original explicit mismatch remains unchanged while trusted parent facts take precedence. */
  const opening = createRpcHost({
    self: { name: 'wrong', instanceId: 'wrong' },
    plugins: [fixture.child],
    onWarning: (warning) => warnings.push(warning),
    report: (error) => fixture.reports.push(error)
  })
  try {
    await fixture.reading.promise
    /**
     * Reuse the original parent's real token admission and semantic handshake instead of fake
     * ready.
     */
    const parentOpening = createRpcHost({
      self: { name: 'parent', instanceId: 'actual-parent' },
      plugins: [fixture.parent],
      report: (error) => fixture.reports.push(error)
    })
    /** Successful construction proves the override completed through the original native path. */
    const [parent, child] = await Promise.all([parentOpening, opening])
    hosts.push(parent, child)
    expect(child.self).toEqual(childSelf)
    expect(fixture.accepted).toMatchObject({ name: childSelf.name, peerId: childSelf.instanceId })
    expect(warnings).toEqual([
      expect.objectContaining({
        code: RpcWarningCode.selfIgnored,
        data: {
          parentName: childSelf.name,
          ignoredName: 'wrong',
          parentInstanceId: childSelf.instanceId,
          ignoredInstanceId: 'wrong'
        }
      })
    ])
    /** Native close failure is expected; the original report must retain that exact Error instance. */
    await Promise.allSettled(hosts.map((host) => host.close()))
    /** The accepted carrier reports its existing cleanup aggregate with the identical native error. */
    const cleanupReports = fixture.reports.filter(
      (error): error is AggregateError => error instanceof AggregateError
    )
    expect(cleanupReports.flatMap((error) => error.errors)).toContain(cleanup)
    expect(fixture.childCloses).toBe(1)
  } finally {
    await Promise.allSettled(hosts.map((host) => host.close()))
    await fixture.close()
  }
})

it('releases a late actual bootstrap after cancellation', async () => {
  /** Cancellation reaches the actual child acquisition before its late raw return. */
  const fixture = new NativeBootstrapFixture(true)
  /** This is the original caller signal and the exact original cancellation cause. */
  const controller = new AbortController()
  /** The original error object must remain the construction cancellation cause. */
  const reason = new Error('cancel actual bootstrap preparation')
  /** Public construction observes the genuine native child owner throughout preparation. */
  const opening = createRpcHost({
    plugins: [fixture.child],
    signal: controller.signal,
    report: (error) => fixture.reports.push(error)
  })
  /** Native cancellation keeps the same original AbortError/cause oracle. */
  const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError', cause: reason })
  try {
    await fixture.reading.promise
    await fixture.parentIO.write(
      encodeRpcStreamFrame(new TextEncoder().encode(JSON.stringify(bootstrap)))
    )
    await fixture.received.promise
    controller.abort(reason)
    fixture.release.resolve()
    await rejected
    expect(fixture.childCloses).toBe(1)
  } finally {
    await fixture.close()
  }
})
