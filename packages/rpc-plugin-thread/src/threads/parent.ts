/**
 * Attaches the child's captured native parent port to the receiving Host and exposes readonly
 * parent-member information. It borrows the parent relationship without acquiring restart
 * authority.
 */
import {
  RpcNativeMembers,
  rpcMemberConnectionDetail,
  RpcMemberSourceKind,
  RpcMemberConnectionDirection,
  type IRpcNativeMemberRecord
} from '@migaia/rpc-host/sdk'
import type {
  IRpcCarrier,
  IRpcSessionHandle,
  IRpcSessionView,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createNodeThreadCarrier } from './channel.js'
import { nativeThreadInitial, threadChildResource, threadWebParent } from './child.js'
import { readNodeThreadRuntime } from './runtime-resource.js'
import type { IThreadBootstrap } from './bootstrap.js'
import { invalidThreadConfig } from './error.js'
import { ThreadErrorText } from './error-text.js'

/** A child borrows its actual native parent connection and never gains native mutation authority. */
class ThreadParent {
  /** Only the installing Host owns accepted Session lifecycle and authoritative local self. */
  readonly #context: IRpcTransportContext
  /** The actual returned Session handle is retired exactly once by that Host. */
  readonly #session: IRpcSessionHandle
  /** Accepted directory is retained as safe descriptive data after physical departure. */
  #view: IRpcSessionView | undefined
  /** Native physical closure cannot be mistaken for a live accepted parent. */
  #closed = false
  /** Passive member observations are created only after actual ready publication. */
  #members: RpcNativeMembers<'thread'> | undefined
  /** One borrowed registration needs no second member index. */
  readonly #record: IRpcNativeMemberRecord
  /** Attach trusted bootstrap facts through the sole Session owner. */
  constructor(
    context: IRpcTransportContext,
    name: string,
    carrier: IRpcCarrier,
    initial: IThreadBootstrap
  ) {
    this.#context = context
    try {
      this.#session = context.attach(carrier, initial.source)
    } catch (primary) {
      void carrier.close(primary).catch(context.report)
      throw primary
    }
    this.#record = {
      name,
      ownership: 'borrowed',
      current: this.#current,
      describe: this.#describe,
      now: () => systemScheduler.now()
    }
    void this.#session.closed.then(
      () => {
        this.#closed = true
      },
      (error) => {
        this.#closed = true
        context.report(error)
      }
    )
  }
  /** Publish only the actual accepted parent; factory construction itself grants no readiness. */
  async open() {
    try {
      this.#view = await this.#session.ready
    } catch (primary) {
      try {
        await this.#dispose()
      } catch (cleanup) {
        this.#context.report(cleanup)
      }
      throw primary
    }
    this.#members = new RpcNativeMembers({
      kind: 'thread',
      self: this.#context.self(),
      report: this.#context.report,
      source: {
        values: () => [this.#record],
        byName: (name) => (name === this.#record.name ? this.#record : undefined),
        byInstance: (id) => (id === this.#view?.peerId ? this.#record : undefined)
      }
    })
    this.#members.publishReady(this.#record, this.#view, this.#view.generation.value)
    return { namespaceExtensions: { members: this.#members.value }, dispose: this.#dispose }
  }
  /** Borrowed native parent state cannot confer a supervisor or a restart lease. */
  readonly #current = () => ({
    generation: this.#view?.generation.value ?? 0,
    active: this.#view !== undefined && !this.#closed,
    ...(this.#view ? { session: this.#view } : {})
  })
  /**
   * Safe local queries reuse the common projection and leave native resources explicitly
   * unavailable.
   */
  readonly #describe = async () => [
    rpcMemberConnectionDetail({
      kind: RpcMemberSourceKind.connect,
      direction: RpcMemberConnectionDirection.spawnedBy,
      carrier: this.#view?.peerId ?? this.#record.name,
      ...(this.#view
        ? {
            description: {
              self: {
                name: this.#view.name,
                instanceId: this.#view.peerId,
                generation: this.#view.generation
              },
              methods: [...this.#view.methods.values()]
            }
          }
        : {})
    })
  ]
  /** Retire only the borrowed Session; the launching parent remains the native execution owner. */
  readonly #dispose = async (): Promise<void> => {
    try {
      await this.#context.detach(this.#session)
    } finally {
      this.#members?.close()
    }
  }
}

/** Acquire exactly the native child source selected by synchronous factory admission. */
export async function openThreadParent(context: IRpcTransportContext, name: string) {
  /** Bun/Deno reuse the guard's real initial capture and same cold carrier. */
  const port = threadWebParent()
  if (port) {
    /** Captured input comes only from this actual native Worker global. */
    const source = await threadChildResource(port).open(context.report, context.signal)
    return new ThreadParent(context, name, source.carrier, source.initial).open()
  }
  /** Node supplies its actual native parentPort and original admitted workerData. */
  const native = readNodeThreadRuntime()
  /** No caller configuration can substitute a fabricated parentPort or bootstrap record. */
  const initial = nativeThreadInitial()
  if (!native?.parentPort || !initial?.source)
    return invalidThreadConfig('connectToParent', ThreadErrorText.bootstrapFailed)
  return new ThreadParent(
    context,
    name,
    createNodeThreadCarrier(native.parentPort, initial.source.expectedPeerId!, context.report),
    {
      ...initial,
      source: {
        ...initial.source,
        isExclusive: () => native.parentPort!.listenerCount('message') === 1
      }
    }
  ).open()
}
