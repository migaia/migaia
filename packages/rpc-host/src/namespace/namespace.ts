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
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import {
  createRpcContractError,
  createRpcError,
  createRpcLifecycleError
} from '../host/error-owner.js'
import { assertCallMethod, type CallTable } from '../call/table.js'
import type { ICallCommand, ICallTargetRef } from '../call/types.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { SessionTable } from '../session/table.js'
import type { IRpcSessionSelection } from '@migaia/rpc-contract/interfaces'
import { callTarget } from '../call/target.js'
import type { IRpcCallOptions, IRpcFanoutResult, IRpcNotifyOptions } from './types.js'
import type { IStreamAdmissionFailure } from '../stream/types.js'

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
  /** Global close seals new work before joining native origin drains. */
  assertOpen?(): void
  sessions: Pick<SessionTable, 'get' | 'select' | 'values' | 'assertTransfer'>
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

/** Project the host's single execution owners into one unique transport namespace. */
export class Namespace {
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
  }

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
    void this.#directInvoke(address, { mode: 'notify', method, payload }, options).catch(
      this.#options.report
    )
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
    const selected = this.#targets()
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
  #assertOpen(): void {
    this.#options.assertOpen?.()
    if (this.#closing) throw this.#reason
  }

  /** Names retain priority over peer-id fallback through SessionTable's canonical selection. */
  #direct(address: string): IRpcSessionSelection {
    this.#assertOpen()
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
  #targets(): readonly IRpcSessionSelection[] {
    this.#assertOpen()
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
      return this.#invoke(this.#direct(address), command, options)
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
      selected = this.#targets()
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
    selected = this.#targets()
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
