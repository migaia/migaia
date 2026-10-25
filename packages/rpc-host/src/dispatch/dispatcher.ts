/**
 * Owns live global and namespace provider catalogs plus source-qualified incoming task membership.
 * Compiles registrations and delegates admitted execution to ProviderInvocation; Session IO and
 * optional dispatch policies remain with their existing collaborators.
 */
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeObservationKind,
  rpcProbeEnvelopeFacts,
  rpcProbeEnvelopeKind
} from '@migaia/rpc-contract/interfaces'
/** Canonical own-data provider catalog, incoming operation table and business completion boundary. */
import {
  RpcCallMode,
  RpcWireKind,
  deserializeRpcWireError,
  type IRpcEnvelope,
  type IRpcMethodDescription
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import type { IRpcFlowContext, IRpcTargetSource } from '@migaia/rpc-contract/interfaces'
import { createRpcError } from '../host/error-owner.js'
import { sameGeneration, sameTask } from '../call/envelope.js'
import { compileProviderMethods } from './catalog.js'
import { ProviderInvocation } from './invocation.js'
import type { ProviderRegistration } from './registration.js'
import { ProviderCatalog } from './catalog-scope.js'
import { ProviderOrdering } from './ordering.js'
import type {
  IProviderCommitGate,
  IProviderDispatcherOptions,
  IProviderMethodEntry,
  IRpcProvide,
  IRpcProvideOptions
} from './types.js'

/** One entry projection is cold, bounded and never reconstructs a per-call provider facade. */
function describe(entry: IProviderMethodEntry): IRpcMethodDescription {
  if (entry.kind === 'forward' && entry.description)
    return Object.freeze({ ...entry.description, name: entry.name, forwardedVia: entry.targetName })
  return Object.freeze({
    name: entry.name,
    supportedModes:
      entry.supportedModes ??
      Object.freeze([RpcCallMode.request, RpcCallMode.notify, RpcCallMode.stream]),
    modeSource: entry.supportedModes ? 'declared' : 'generated-routes',
    ...(entry.declaration ? { idempotent: entry.declaration.idempotent } : {}),
    ...(entry.kind === 'forward' ? { forwardedVia: entry.targetName } : {}),
    ...(entry.declaration?.input === undefined ? {} : { input: entry.declaration.input }),
    ...(entry.declaration?.output === undefined ? {} : { output: entry.declaration.output }),
    ...(entry.declaration?.yield === undefined ? {} : { yield: entry.declaration.yield })
  })
}

/** Incoming task ownership is distinct from optional ordering, schema, quota and replay plugins. */
export class ProviderDispatcher {
  /** IO, flow and global identity are supplied by the Host root. */
  readonly #ports: IProviderDispatcherOptions
  /** Explicit public providers are global to this Host, independent of transport registration. */
  readonly #global = new ProviderCatalog(describe, () => undefined)
  /** Native whitelist entries retain their own transport scope and original installation gate. */
  readonly #native = new Map<string, ProviderCatalog>()
  /** All namespace catalogs share the original root's RPC orderKey FIFO. */
  readonly #ordering = new ProviderOrdering()
  /** Actual operation state is indexed by carrier first, then correlation id in O(1). */
  readonly #incoming = new Map<
    string,
    Map<
      string,
      Readonly<{ envelope: IRpcEnvelope; operation: ProviderInvocation; promise: Promise<void> }>
    >
  >()
  /** Sealing forbids new business admission while original invocations retain their drain lifetime. */
  #closed = false

  /** This owner has no native transport, optional Feature or per-peer request implementation. */
  constructor(ports: IProviderDispatcherOptions) {
    this.#ports = ports
  }

  /** Existing direct registration still publishes synchronously and returns its original disposer. */
  provide(input: IRpcProvide, options?: IRpcProvideOptions): () => void {
    /** The same cold receipt handles native candidates and immediate application registration. */
    const registration = this.prepare(input, options)
    registration.commit()
    return registration.dispose
  }

  /** Compile and reserve without publishing; native commit may replace one exact prior receipt. */
  prepare(
    input: IRpcProvide,
    options?: IRpcProvideOptions & Readonly<{ namespace?: string }>,
    previous?: ProviderRegistration
  ): ProviderRegistration {
    if (this.#closed)
      throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
    /** Compilation captures descriptors once before touching either live keys or cold reservations. */
    const compiled = compileProviderMethods(input, options?.contract)
    return this.#catalog(options?.namespace).prepare(compiled, previous)
  }

  /** Borrow the immutable cached projection; no catalog scan occurs on ordinary calls. */
  describe(namespace?: string): readonly IRpcMethodDescription[] {
    /** Native exposure is private to this transport; explicit public providers remain global. */
    const scoped = namespace === undefined ? undefined : this.#native.get(namespace)
    return scoped ? [...this.#global.description, ...scoped.description] : this.#global.description
  }

  /** Cold installation creates one catalog per native namespace and retires it when empty. */
  #catalog(namespace?: string): ProviderCatalog {
    if (namespace === undefined) return this.#global
    /** Only an actual native install can allocate this scope. */
    let catalog = this.#native.get(namespace)
    if (catalog) return catalog
    /** Identity fencing prevents a late old withdrawal from deleting a replacement scope. */
    const created = new ProviderCatalog(describe, () => {
      if (this.#native.get(namespace) === created) this.#native.delete(namespace)
    })
    catalog = created
    this.#native.set(namespace, catalog)
    return catalog
  }

  /** Route admitted invocation and cancellation frames through the original task's exact table slot. */
  accept(
    source: IRpcFlowContext,
    envelope: IRpcEnvelope,
    rejection?: Readonly<{ error: unknown }>,
    targetSource?: IRpcTargetSource,
    sourceGate?: IProviderCommitGate
  ): Promise<void> {
    /** The carrier index grants no authority to a same id from another physical session. */
    const table = this.#incoming.get(source.carrierId)
    if (envelope.kind === RpcWireKind.cancel) {
      /** Cancellation must echo the original compact task, not merely guess a public id. */
      const incoming = table?.get(envelope.id)
      if (incoming && sameTask(incoming.envelope.task, envelope.task)) {
        /** Restore once so the actual cancellation observer and operation share the same reason. */
        const reason =
          envelope.reason === undefined ? undefined : deserializeRpcWireError(envelope.reason)
        this.#ports.observe?.({
          kind: RpcProbeObservationKind.event,
          namespace: source.namespace,
          carrierId: source.carrierId,
          peerId: source.session?.peerId,
          id: envelope.id,
          data: {
            ...rpcProbeEnvelopeFacts(envelope),
            stage: RpcProbeStage.message,
            direction: RpcProbeDirection.inbound,
            kind: rpcProbeEnvelopeKind(envelope),
            outcome: RpcProbeOutcome.received,
            error: reason
          }
        })
        incoming.operation.cancel(reason)
      }
      return Promise.resolve()
    }
    if (
      envelope.kind !== RpcWireKind.call &&
      envelope.kind !== RpcWireKind.group &&
      !(envelope.kind === RpcWireKind.outcome && envelope.operation === 'lookup')
    )
      return Promise.resolve()
    /** An active duplicate references the original business completion without invoking twice. */
    const existing = table?.get(envelope.id)
    if (existing) return existing.promise
    /**
     * Capture only selected local/forward entries; admission errors still receive a correlated
     * terminal.
     */
    const methods = new Map<string, IProviderMethodEntry>()
    /** Error presence is explicit because a supported hook can throw undefined. */
    let admission: Readonly<{ error: unknown }> | undefined
    try {
      if (rejection) throw rejection.error
      if (this.#closed)
        throw createRpcError(RpcCoreErrorCode.endpointDisposed, RpcCoreErrorText.endpointDisposed)
      if (!sameGeneration(this.#ports.self().generation, envelope.task.targetGeneration))
        throw createRpcError(
          RpcCoreErrorCode.providerGenerationMismatch,
          RpcCoreErrorText.providerGenerationMismatch
        )
      /** Each group member performs one exact local lookup before direct-directory fallback. */
      const steps =
        envelope.kind === RpcWireKind.group
          ? envelope.steps
          : envelope.kind === RpcWireKind.call
            ? [{ method: envelope.task.method! }]
            : []
      for (const step of steps) {
        /** Source namespace takes priority over a unique global forwarding name. */
        const entry =
          this.#native.get(source.namespace)?.lookup(step.method) ??
          this.#global.methods.get(step.method) ??
          this.#ports.forward.resolveEntry(source.namespace, step.method, source, envelope)
        if (entry) methods.set(step.method, entry)
      }
    } catch (error) {
      admission = { error }
    }
    /** Original task headers and compact selected registrations remain fixed through plugin waits. */
    const operation = new ProviderInvocation({
      ports: this.#ports,
      source,
      envelope,
      methods,
      admission,
      targetSource,
      sourceGate,
      ordering: this.#ordering
    })
    /** Publish before dispatch so synchronous hooks/reentrant cancellation observe the original id. */
    const entries = table ?? new Map()
    if (!table) this.#incoming.set(source.carrierId, entries)
    /** The async entry point runs in a continuation after its exact slot is visible. */
    const context = {
      owner: this,
      carrierId: source.carrierId,
      id: envelope.id,
      entries,
      operation
    }
    /** The retained Promise is the actual business terminal, never the physical notify write. */
    const promise = Promise.resolve()
      .then(() => context.operation.run())
      .finally(() => {
        if (context.entries.get(context.id)?.operation === context.operation)
          context.entries.delete(context.id)
        if (
          context.entries.size === 0 &&
          context.owner.#incoming.get(context.carrierId) === context.entries
        )
          context.owner.#incoming.delete(context.carrierId)
      })
    entries.set(envelope.id, { envelope, operation, promise })
    if (targetSource) targetSource.track(source.carrierId, promise)
    else this.#ports.track?.(source.carrierId, promise)
    return promise
  }

  /** Join this failed native gate's existing terminals before physical rollback retires their IO. */
  async settleFailedGate(gate: IProviderCommitGate): Promise<void> {
    if (!gate.isFailed()) return
    /** Existing operation Promises include the correlated physical terminal and original reporting. */
    const pending: Promise<void>[] = []
    for (const table of this.#incoming.values())
      for (const { operation, promise } of table.values())
        if (operation.belongsToGate(gate)) pending.push(promise)
    await Promise.allSettled(pending)
  }

  /** Retire only the departed physical generation and release its compact index immediately. */
  retire(carrierId: string, reason: unknown): void {
    /** Detached work can finish cleanup but cannot send through a replacement source. */
    const table = this.#incoming.get(carrierId)
    if (!table) return
    this.#incoming.delete(carrierId)
    for (const entry of table.values()) entry.operation.retire(reason)
    table.clear()
  }

  /** Reject new admission while existing provider operations retain their original completion. */
  seal(): void {
    this.#closed = true
  }

  /** Stop new business, abort original tasks and release registrations without reviving the owner. */
  close(reason: unknown): void {
    this.seal()
    for (const carrierId of this.#incoming.keys()) this.retire(carrierId, reason)
    this.#global.close()
    for (const catalog of this.#native.values()) catalog.close()
    this.#native.clear()
  }
}
