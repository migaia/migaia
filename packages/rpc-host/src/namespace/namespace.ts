/**
 * Own one transport namespace's public calls and held method capabilities; all physical work stays
 * in SessionTable.
 */
import type {
  IRpcMethodDescription,
  IRpcPortableValue,
  IRpcStep,
  IRpcStepOutcome
} from '@migaia/rpc-contract/protocol'
import { normalizeRpcTrace } from '@migaia/rpc-contract/protocol'
import type {
  IRpcSessionView,
  IRpcTransportDefinition,
  IRpcTransportInstallation
} from '@migaia/rpc-contract/interfaces'
import { getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import {
  createAbortController,
  createLifecycleScope,
  type ILifecycleScope
} from '@migaia/lifecycle'
import { observeAbortSubscription } from '@migaia/lifecycle/abort'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  RpcCoreErrorText,
  RpcLifecycleError,
  RuntimeApiErrorText,
  tagRpcError
} from '@migaia/rpc-contract/errors'
import {
  createRpcContractError,
  createRpcError,
  createRpcLifecycleError,
  isLocalRpcError
} from '../host/error-owner.js'
import { assertCallMethod, type CallTable } from '../call/table.js'
import type { ICallCommand, ICallTargetRef } from '../call/types.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { SessionTable } from '../session/table.js'
import type { IRpcSessionSelection } from '@migaia/rpc-contract/interfaces'
import { callTarget } from '../call/target.js'
import type {
  IRpcCallOptions as IPublicCallOptions,
  IRpcFanoutResult,
  IRpcNotifyOptions as IPublicNotifyOptions,
  IRpcClosingHandler,
  IRpcPeerClosedHandler
} from './types.js'
import type { IRpcSessionScope } from '../session/types.js'
import type { IStreamAdmissionFailure } from '../stream/types.js'
import type { IProviderCommitGate } from '../dispatch/types.js'
import { createProviderCommitGate } from '../dispatch/exposure.js'
import { HostErrorText } from '../host/error-text.js'
import type { IRpcTransportSetupContext } from '../sdk/types.js'
import { RpcInstallationSetup } from '../sdk/flow-setup.js'

/** Per-source native extensions remain distinct from the fixed RPC namespace publication. */
const sourceFamily = Object.freeze({})
/** One ordered boundary defines publication and forbids extensions replacing mandatory calls. */
const reservedMethods = new Set<PropertyKey>([
  'peers',
  'request',
  'notify',
  'send',
  'dispatch',
  'group',
  'stream',
  'streamTo',
  'close',
  'onClosing',
  'onPeerClosed',
  Symbol.asyncDispose
])

/** Runtime admission can read a supported intent; public namespace types condition its presence. */
type IRpcCallOptions = IPublicCallOptions<true>
/** Directed notifications use the same optional local closing intent as all other call modes. */
type IRpcNotifyOptions = IPublicNotifyOptions<true>

/** Preserve synchronous local trace admission while the one Contract validator owns its grammar. */
function assertTrace(options: IRpcCallOptions): void {
  /** Caller metadata is captured before any asynchronous call or physical write can begin. */
  const trace = options.trace
  if (trace === undefined) return
  try {
    normalizeRpcTrace(trace)
  } catch (cause) {
    throw createRpcContractError(RpcCoreErrorText.traceInvalid, cause)
  }
}

/** Namespace borrows only actual operation ports, never a per-session callable peer. */
export type INamespaceOptions = Readonly<{
  name: string
  /** Cold transport metadata alone determines which closing APIs this namespace publishes. */
  closingWrites: boolean
  /** Event registrations remain isolated to the original installation, including staged rollback. */
  sessionScope: IRpcSessionScope
  /** The original namespace resource owner also joins late source registrations at shutdown. */
  resources: ILifecycleScope
  configuredReport?: (error: unknown) => void
  settleFailedGate(gate: IProviderCommitGate): Promise<void>
  /** Global close seals new work before joining native origin drains. */
  assertOpen?(): void
  sessions: Pick<
    SessionTable,
    | 'get'
    | 'select'
    | 'values'
    | 'assertTransfer'
    | 'onClosing'
    | 'onPeerClosed'
    | 'stageAppend'
    | 'commitAppend'
    | 'context'
    | 'closeScope'
    | 'releaseScope'
  >
  calls: Pick<CallTable, 'invoke'>
  stream(
    target: ICallTargetRef,
    method: string,
    payload?: IRpcPortableValue,
    options?: IRpcCallOptions,
    admission?: IStreamAdmissionFailure
  ): AsyncIterableIterator<IRpcPortableValue>
  hold(selection: IRpcSessionSelection, method: IRpcMethodDescription): Function
  close(reason: unknown): Promise<void>
  report(error: unknown): void
}>

/** Null-prototype result maps retain the existing public fanout key and error identities. */
function fanout<T>(): {
  fulfilled: Partial<Record<string, T>>
  rejected: Partial<Record<string, unknown>>
} {
  return { fulfilled: Object.create(null), rejected: Object.create(null) }
}

/** One broadcast passes its retained state explicitly to each independent settlement callback. */
type IFanoutDelivery = Readonly<{
  invoke(
    selection: IRpcSessionSelection,
    command: ICallCommand,
    options: IRpcCallOptions
  ): Promise<unknown>
  command: ICallCommand
  options: IRpcCallOptions
  result: {
    fulfilled: Partial<Record<string, unknown>>
    rejected: Partial<Record<string, unknown>>
  }
}>

/** Preserve each actual target's value/error while releasing the broadcast context at settlement. */
async function settleDelivery(
  context: IFanoutDelivery,
  selection: IRpcSessionSelection
): Promise<void> {
  /** This tagged public key preserves unusual peer names without inherited dictionary members. */
  const key = JSON.stringify(['target', selection.view.name])
  try {
    context.result.fulfilled[key] = await context.invoke(
      selection,
      context.command,
      context.options
    )
  } catch (error) {
    context.result.rejected[key] = error
  }
}

/** One native source retains the original staged admission and resource receipts, not a registry. */
class NamespaceSource {
  /** The actual receiving namespace lends identity indexes, reporting and its existing resources. */
  readonly #owner: Namespace
  /** Source cleanup borrows its namespace's actual table and resource ports. */
  readonly #options: INamespaceOptions
  /** The genuine source registration alone grants native commit and rollback authority. */
  readonly #core: IPluginHostCore
  /** Original native source construction remains with its concrete transport factory. */
  readonly #definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>
  /** Acquisition cancellation stays live until the same source Sessions finish closing. */
  readonly #controller = createAbortController()
  /** Actual acquired source and Session handles retain original reverse cleanup ownership. */
  readonly #resources = createLifecycleScope({ errorPolicy: 'collect' })
  /** One existing gate fences both source publication and incoming business operations. */
  readonly #gate: ReturnType<typeof createProviderCommitGate>
  /** The appended scope borrows canonical identity indexes without creating another peer table. */
  readonly #scope: IRpcSessionScope
  /** Reentrant native/namespace removal joins this same actual cleanup. */
  #closing: Promise<void> | undefined

  /** Publish resource ownership before native source construction can yield or reenter. */
  constructor(
    owner: Namespace,
    options: INamespaceOptions,
    core: IPluginHostCore,
    definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>
  ) {
    this.#owner = owner
    this.#options = options
    this.#core = core
    this.#definition = definition
    this.#gate = createProviderCommitGate(core.lifecycle.signal)
    this.#scope = options.sessions.stageAppend(
      options.sessionScope,
      {
        signal: this.#controller.signal,
        handshakeTimeoutMs: definition.handshakeTimeoutMs,
        nameAdmissionTimeoutMs: definition.nameAdmissionTimeoutMs
      },
      this.#gate
    )
    options.resources.own(this, { force: () => this.close() })
    core.onDispose(() => this.close(core.lifecycle.signal.reason))
  }

  /** Original native open runs under this source core; only its native commit publishes peers. */
  async open(): Promise<void> {
    /** Source callbacks use their original resource lifetime while borrowing the fixed namespace. */
    const context: IRpcTransportSetupContext = {
      owner: this.#core,
      configuredReport: this.#options.configuredReport,
      ...this.#options.sessions.context(
        this.#scope,
        this.#resources,
        () => this.#controller.signal.reason
      )
    }
    /** Only the original opener supplies native extensions and their exact disposer. */
    const installed = await this.#owner.openTransport(
      this.#core,
      this.#definition,
      context,
      this.#resources,
      this.close
    )
    /** This is a native extension key only; it declares no RPC namespace or pipeline group. */
    const value = installed.namespaceExtensions ?? Object.freeze({})
    /** Native publication remains tied to this original source core's own commit receipt. */
    const slot = getPluginRuntimeIntegration(this.#core).acquireSharedSlot(
      this.#definition.namespace,
      sourceFamily,
      () => value
    )
    slot.register(value, () => {
      this.#gate.open()
      this.#options.sessions.commitAppend(this.#scope)
    })
  }

  /** Fail admission before joining its actual terminals, then close Session before native media. */
  readonly close = (reason?: unknown): Promise<void> => {
    if (!this.#closing) {
      this.#gate.fail(reason)
      this.#closing = this.#release(reason)
    }
    return this.#closing
  }

  /** Release only this source's exact scope; parent namespace handlers and other sources survive. */
  async #release(reason: unknown): Promise<void> {
    await this.#options.settleFailedGate(this.#gate)
    /** Every original cleanup error remains reachable in observed release order. */
    const failures: unknown[] = []
    try {
      await this.#options.sessions.closeScope(this.#scope, reason)
    } catch (error) {
      failures.push(error)
    }
    this.#controller.abort(reason)
    /** Original lifecycle collection preserves all native cleanup failures without early exit. */
    const cleanup = await this.#resources.dispose()
    this.#options.sessions.releaseScope(this.#scope)
    this.#options.resources.release(this)
    for (const entry of cleanup) failures.push(entry.error)
    if (failures.length) {
      /** The first failure remains exact, with aggregates used only for multiple original failures. */
      const error =
        failures.length === 1
          ? failures[0]
          : createRpcLifecycleError(
              RpcCoreErrorText.endpointDisposed,
              new AggregateError(failures, HostErrorText.cleanupFailed)
            )
      this.#options.report(error)
      throw error
    }
  }
}

/** Project the host's single execution owners into one unique transport namespace. */
export class Namespace {
  /** Public closing methods exist only when this cold transport declaration is true. */
  readonly closingWrites: boolean
  /** Explicit collaborators own calls, streams, accepted session lookup and transport shutdown. */
  readonly #options: INamespaceOptions
  /** These callable snapshots retain compact generation metadata, never mutable Session instances. */
  readonly #peers: Record<string, object> = Object.create(null)
  /** Exact carrier identity prevents an old retirement from removing its same-name successor. */
  readonly #peerCarriers = new Map<string, string>()
  /** One close operation supplies one original lifecycle error to every new namespace call. */
  #closing: Promise<void> | undefined
  /** Retain the exact terminal reason rather than minting one wrapper per concurrent operation. */
  #reason: unknown

  /** Native publication receives this owner's one stable namespace projection. */
  constructor(options: INamespaceOptions) {
    this.#options = options
    this.closingWrites = options.closingWrites
  }

  /** Publish approved calls and installed extensions as one immutable namespace-owned surface. */
  surface(
    flowExtensions: readonly Readonly<Record<string, unknown>>[],
    transportExtensions?: object
  ): Record<PropertyKey, unknown> {
    /** This owner lends exact call identities without exposing its mutable collaborators. */
    const surface: Record<PropertyKey, unknown> = {}
    for (const key of reservedMethods) {
      if ((key === 'onClosing' || key === 'onPeerClosed') && !this.closingWrites) continue
      surface[key] = key === Symbol.asyncDispose ? this.close : Reflect.get(this, key)
    }
    for (const extension of flowExtensions) this.#extend(surface, extension)
    if (transportExtensions)
      this.#extend(surface, transportExtensions as Readonly<Record<string, unknown>>)
    return Object.freeze(surface)
  }

  /** Installed native contributions cannot override mandatory namespace methods or one another. */
  #extend(surface: object, extension: Readonly<Record<string, unknown>>): void {
    for (const key of Reflect.ownKeys(extension)) {
      if (reservedMethods.has(key) || Object.hasOwn(surface, key))
        throw tagRpcError(
          new TypeError(HostErrorText.namespaceDuplicate),
          RpcCoreErrorCode.invalidConfig
        )
      /** Snapshot descriptors without running extension accessors. */
      const descriptor = Object.getOwnPropertyDescriptor(extension, key)!
      if (!Object.hasOwn(descriptor, 'value'))
        throw tagRpcError(
          new TypeError(HostErrorText.pluginInvalid),
          RpcCoreErrorCode.invalidConfig
        )
      Object.defineProperty(surface, key, { ...descriptor, configurable: false, writable: false })
    }
  }

  /** A genuine source definition joins this already-declared namespace's original admission owner. */
  installSource(
    core: IPluginHostCore,
    definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>
  ): Promise<void> {
    this.#assertOpen()
    return new NamespaceSource(this, this.#options, core, definition).open()
  }

  /** Transport and source acquisition share the original operation-abort and resource handoff. */
  async openTransport(
    core: IPluginHostCore,
    definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>,
    context: IRpcTransportSetupContext,
    resources: ILifecycleScope,
    close: (reason: unknown) => Promise<void>
  ): Promise<IRpcTransportInstallation<object>> {
    /** This receipt borrows actual close/report ports without retaining a second lifecycle owner. */
    const operation = { close, report: this.#options.report }
    /** This native operation receipt cancels only the registration whose open is still pending. */
    const preparing = observeAbortSubscription(
      core.operation.signal,
      (reason) => void operation.close(reason).catch(operation.report),
      operation.report
    )
    core.onDispose(preparing.unsubscribe)
    try {
      /** Native transport and flow setup reuse the same cancellation and late-cleanup handoff. */
      return await new RpcInstallationSetup({
        setup: () => definition.open(context),
        own: (installed) => resources.own(installed, { force: () => installed.dispose() }),
        report: operation.report,
        signals: [context.signal, core.operation.signal]
      }).run()
    } finally {
      preparing.unsubscribe()
    }
  }

  /** Handlers borrow the original SessionTable scope; Namespace owns no parallel listener set. */
  readonly onClosing = (handler: IRpcClosingHandler): (() => void) =>
    this.#options.sessions.onClosing(this.#options.sessionScope, handler)

  /** Native loss and close-frame events use the same scoped table publication owner. */
  readonly onPeerClosed = (handler: IRpcPeerClosedHandler): (() => void) =>
    this.#options.sessions.onPeerClosed(this.#options.sessionScope, handler)

  /** Readonly public capability groups are replaced only at accepted generation changes. */
  get peers(): Readonly<Record<string, object>> {
    return this.#peers
  }

  /** Installed namespace extensions originate ordinary semantic calls through the same work owner. */
  invoke(command: ICallCommand, options: IRpcCallOptions = {}): Promise<unknown> {
    return this.#broadcast(command, options)
  }

  /** Broadcast preserves zero/many fanout records and a single target's original scalar result. */
  readonly request = (
    method: string,
    payload?: IRpcPortableValue,
    options: IRpcCallOptions = {}
  ): Promise<unknown> => this.#broadcast({ mode: 'request', method, payload }, options)

  /** Notify resolves after physical write; only its actual caller signal retains cancellation. */
  readonly notify = (
    method: string,
    payload?: IRpcPortableValue,
    options: IRpcNotifyOptions = {}
  ): Promise<unknown> =>
    options.targetId === undefined
      ? this.#broadcast({ mode: 'notify', method, payload }, options)
      : this.#directInvoke(options.targetId, { mode: 'notify', method, payload }, options)

  /** Directed scalar calls select one current accepted binding through the O(1) namespace indexes. */
  readonly send = (
    address: string,
    method: string,
    payload?: IRpcPortableValue,
    options: IRpcCallOptions = {}
  ): Promise<unknown> => this.#directInvoke(address, { mode: 'request', method, payload }, options)

  /** Fire-and-report retains native rejection timing without introducing provider acknowledgement. */
  readonly dispatch = (
    address: string,
    method: string,
    payload?: IRpcPortableValue,
    options: IRpcCallOptions = {}
  ): void => {
    assertTrace(options)
    try {
      void this.#invoke(
        this.#direct(address, options),
        { mode: 'notify', method, payload },
        options
      ).catch(this.#options.report)
    } catch (error) {
      this.#options.report(error)
    }
  }

  /** Context notifications retain explicit selection or skip the original caller in index order. */
  notifyFrom(
    input: Readonly<{ id?: string; method: string; data: unknown }>,
    signal?: IAbortSignal,
    excludePeerId?: string
  ): void {
    if (input.id !== undefined) {
      this.dispatch(input.id, input.method, input.data as IRpcPortableValue, { signal })
      return
    }
    for (const selection of this.#targets())
      if (selection.view.peerId !== excludePeerId)
        this.dispatch(selection.view.peerId, input.method, input.data as IRpcPortableValue, {
          signal
        })
  }

  /** Each selected target executes its steps in order and retains its own not-executed suffix. */
  readonly group = (steps: readonly IRpcStep[], options: IRpcCallOptions = {}): Promise<unknown> =>
    this.#broadcast({ mode: 'group', steps }, options)

  /** Stream selection is synchronous, while each returned iterator owns its independent lazy call. */
  readonly stream = (
    method: string,
    payload?: IRpcPortableValue,
    options: IRpcCallOptions = {}
  ):
    | AsyncIterableIterator<IRpcPortableValue>
    | IRpcFanoutResult<AsyncIterableIterator<IRpcPortableValue>> => {
    assertTrace(options)
    /** One snapshot fixes target identity before any iterator starts. */
    const selected = this.#targets(options)
    this.#assertTransfer(selected, options)
    if (selected.length === 1) return this.#stream(selected[0]!, method, payload, options)
    /** Stream fanout contains iterators, never promises masquerading as an iterator. */
    const result = fanout<AsyncIterableIterator<IRpcPortableValue>>()
    for (const selection of selected) {
      /** Established tagged keys remain stable for unusual application peer names. */
      const key = JSON.stringify(['target', selection.view.name])
      try {
        result.fulfilled[key] = this.#stream(selection, method, payload, options)
      } catch (error) {
        result.rejected[key] = error
      }
    }
    return result
  }

  /** Directed streams use the same accepted binding, admission and lazy consumer as broadcast. */
  readonly streamTo = (
    address: string,
    method: string,
    payload?: IRpcPortableValue,
    options: IRpcCallOptions = {}
  ): AsyncIterableIterator<IRpcPortableValue> => {
    assertTrace(options)
    /** StreamChannel owns the sole target's transfer preflight before constructing its consumer. */
    return this.#stream(this.#direct(address, options), method, payload, options)
  }

  /** Cache method capabilities only after the actual accepted session is published. */
  accepted(selection: IRpcSessionSelection): void {
    /** Own-data null groups cannot trigger inherited setters or getters during projection. */
    const capabilities: Record<string, unknown> = Object.create(null)
    for (const description of selection.view.methods.values()) {
      /** Method paths have the existing bounded catalog depth, so construction remains cold O(n). */
      const parts = description.name.split('.')
      /** Each path descends into this newly owned graph, never the caller's provide object. */
      let group = capabilities
      for (let index = 0; index < parts.length - 1; index++) {
        /** A group is allocated only for an actual admitted path prefix. */
        const key = parts[index]!
        group = (group[key] ??= Object.create(null)) as Record<string, unknown>
      }
      group[parts[parts.length - 1]!] = this.#options.hold(selection, description)
    }
    this.#peers[selection.view.name] = capabilities
    this.#peerCarriers.set(selection.view.name, selection.carrierId)
  }

  /** Retire only this exact generation's public projection; held functions keep their own fence. */
  retired(carrierId: string, view: IRpcSessionView | undefined): void {
    if (view && this.#peerCarriers.get(view.name) === carrierId) {
      this.#peerCarriers.delete(view.name)
      delete this.#peers[view.name]
    }
  }

  /** All close callers share this Promise and the same reason used to reject new calls. */
  readonly close = (reason?: unknown): Promise<void> => {
    if (!this.#closing) {
      this.#reason = reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      this.#closing = Promise.resolve().then(() => this.#options.close(this.#reason))
      /** Root retirement withdraws this owner before asynchronous carrier cleanup can call back. */
      for (const name of this.#peerCarriers.keys()) delete this.#peers[name]
      this.#peerCarriers.clear()
    }
    return this.#closing
  }

  /** New work rejects with the exact reason already selected by this namespace's close owner. */
  #assertOpen(options?: IRpcCallOptions): void {
    if (options?.keepalive === true) {
      if (!this.closingWrites)
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.capabilityUnsupported)
      return
    }
    try {
      this.#options.assertOpen?.()
      if (this.#closing) throw this.#reason
    } catch (reason) {
      if (isLocalRpcError(reason, RpcLifecycleError)) throw reason
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed, reason)
    }
  }

  /** Names retain priority over peer-id fallback through SessionTable's canonical selection. */
  #direct(address: string, options: IRpcCallOptions): IRpcSessionSelection {
    this.#assertOpen(options)
    /** Invalid addresses never enter the host's source/name indexes. */
    const selection =
      typeof address === 'string' && address
        ? this.#options.sessions.select(this.#options.name, address)
        : undefined
    if (!selection)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    return selection
  }

  /** Enumerate only this namespace; broadcasting never visits another transport's peers. */
  #targets(options?: IRpcCallOptions): readonly IRpcSessionSelection[] {
    this.#assertOpen(options)
    return this.#options.sessions.values(this.#options.name)
  }

  /** Current advertised methods are the sole admission source, including qualified forward paths. */
  #assertMethod(
    selection: IRpcSessionSelection,
    method: string,
    mode: IRpcMethodDescription['supportedModes'][number]
  ): void {
    assertCallMethod(method)
    /** Cold directory compilation made every method/mode lookup O(1). */
    const description = selection.view.methods.get(method)
    if (!description)
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    if (!description.supportedModes.includes(mode))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RuntimeApiErrorText.methodUnavailable
      )
  }

  /** Unknown methods return a lazy local terminal without entering the stream's physical owner. */
  #stream(
    selection: IRpcSessionSelection,
    method: string,
    payload: IRpcPortableValue | undefined,
    options: IRpcCallOptions
  ): AsyncIterableIterator<IRpcPortableValue> {
    /** The original consumer owns lazy start and sticky settlement for this local admission error. */
    let admission: IStreamAdmissionFailure | undefined
    try {
      this.#assertMethod(selection, method, 'stream')
    } catch (error) {
      admission = { error }
    }
    return this.#options.stream(callTarget(selection), method, payload, options, admission)
  }

  /** Directed and broadcast calls share the accepted target's current directory admission. */
  readonly #invoke = (
    selection: IRpcSessionSelection,
    command: ICallCommand,
    options: IRpcCallOptions
  ): Promise<unknown> => {
    if ('method' in command) this.#assertMethod(selection, command.method, command.mode)
    return this.#options.calls.invoke(callTarget(selection), command, options)
  }

  /** Directed selection failures remain asynchronous public rejections, as in the original host. */
  #directInvoke(
    address: string,
    command: ICallCommand,
    options: IRpcCallOptions
  ): Promise<unknown> {
    assertTrace(options)
    try {
      return this.#invoke(this.#direct(address, options), command, options)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Native transfer rejection precedes getters and fanout settlement at the public call boundary. */
  #broadcast(command: ICallCommand, options: IRpcCallOptions): Promise<unknown> {
    assertTrace(options)
    if (!Object.hasOwn(options, 'transfer')) return this.#deliver(command, options)
    /** Retain one actual selection; ordinary selection failures keep their Promise rejection timing. */
    let selected: readonly IRpcSessionSelection[]
    try {
      selected = this.#targets(options)
    } catch (error) {
      return Promise.reject(error)
    }
    this.#assertTransfer(selected, options)
    return this.#deliver(command, options, selected)
  }

  /** Each real carrier owns its capability check; no payload or transfer getter is observed here. */
  #assertTransfer(selected: readonly IRpcSessionSelection[], options: IRpcCallOptions): void {
    if (Object.hasOwn(options, 'transfer'))
      for (const selection of selected)
        this.#options.sessions.assertTransfer(selection.carrierId, options)
  }

  /** Independent target settlements preserve actual values/errors and original fanout key shape. */
  async #deliver(
    command: ICallCommand,
    options: IRpcCallOptions,
    selected = this.#targets(options)
  ): Promise<unknown> {
    if (selected.length === 1) return this.#invoke(selected[0]!, command, options)
    /** The result remains null-prototype even for zero targets. */
    const result = fanout<unknown | readonly IRpcStepOutcome[]>()
    /** Every callback receives this explicit context instead of capturing independent call state. */
    const context: IFanoutDelivery = { invoke: this.#invoke, command, options, result }
    await Promise.all(selected.map((selection) => settleDelivery(context, selection)))
    return result
  }
}
