/** Direct-session forwarding reuses the Host call and stream owners without transit retry. */
import {
  RpcCallMode,
  RpcWireLimit,
  type IRpcMethodDescription,
  type IRpcPortableValue,
  type IRpcStep,
  type IRpcEnvelope,
  type IRpcCallOptions
} from '@migaia/rpc-contract/protocol'
import { REMOTE_NAME_PATTERN } from '@migaia/rpc-contract/protocol'

import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText, RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import {
  RpcProbeStage,
  RpcProbeOutcome,
  RpcProbeDirection,
  RpcProbeObservationKind,
  RpcProbeForwardRejection,
  rpcProbeEnvelopeFacts,
  type IRpcObservation,
  type IRpcFlowContext,
  type IRpcSessionSelection
} from '@migaia/rpc-contract/interfaces'
import type { ICallCommand, ICallLocalOptions, ICallTargetRef } from '../call/types.js'
import { sameGeneration } from '../call/envelope.js'
import { callTarget } from '../call/target.js'
import { createRpcError } from '../host/error-owner.js'
import {
  registerLocalErrorWireRoute,
  registerLocalErrorWireSummary
} from '../host/error-wire-metadata.js'
import { forwardHint, retainProviderForwardMethod } from '../dispatch/catalog.js'
import type { IProviderForwardEntry, IRpcContext } from '../dispatch/types.js'
import { ForwardErrorText } from './text.js'

/** Accepted facts are borrowed only during selection and never retained in a callable capability. */
export type IForwardSelection = IRpcSessionSelection
/** Namespace caches the own-data tree while this function keeps only compact original identity. */
export type IProviderMethodCallable = (
  payload?: IRpcPortableValue,
  options?: ICallLocalOptions
) => unknown
/** Root owns directory lookup, global node identity, and all actual outbound operation state. */
export type IForwarderOptions = Readonly<{
  maxHops?: number
  observation?: Readonly<{
    facts(namespace: string): Readonly<{ observing: boolean }>
    observe(event: IRpcObservation): void
  }>
  nodeId(): string
  resolve(namespace: string, name: string): IForwardSelection | undefined
  current(carrierId: string): IForwardSelection | undefined
  sourceNodeId(carrierId: string): string | undefined
  call(target: ICallTargetRef, command: ICallCommand, options?: ICallLocalOptions): Promise<unknown>
  stream(
    target: ICallTargetRef,
    method: string,
    payload?: IRpcPortableValue,
    options?: ICallLocalOptions
  ): AsyncIterableIterator<IRpcPortableValue>
}>

/** Per-host route validation preserves the original loop-before-hop refusal order. */
function forwardRoute(
  route: readonly string[],
  nodeId: string,
  maxHops: number,
  nextNodeId?: string
): readonly string[] {
  /** Incoming route contains the origin plus previously visited forwarding hosts. */
  const error =
    route.includes(nodeId) ||
    (nextNodeId !== undefined && (nextNodeId === nodeId || route.includes(nextNodeId)))
      ? createRpcError(RpcCoreErrorCode.forwardLoop, RpcCoreErrorText.forwardLoop)
      : route.length > maxHops
        ? createRpcError(RpcCoreErrorCode.forwardHopLimit, RpcCoreErrorText.forwardHopLimit)
        : undefined
  if (error) {
    /** The original route is diagnostic data, never a different live error authority. */
    const snapshot = Object.freeze([...route])
    Object.defineProperty(error, 'route', { value: snapshot, enumerable: true })
    registerLocalErrorWireRoute(error, snapshot)
    registerLocalErrorWireSummary(error, error.code, error.message, {
      preserveSerializedError: true
    })
    throw error
  }
  return Object.freeze([...route, nodeId])
}

/** Only peer-name spelling is indexed here; SessionTable remains the accepted target owner. */
type IForwardPrefix = {
  children: Map<string, IForwardPrefix>
  /** Live exact-name contributions exclude longer names sharing this character prefix. */
  references: number
  namespaces: Map<string, number>
  name?: string
}

/** Automatic namespace segments retain their established own-data method grammar. */
const namespaceSegment = new RegExp(REMOTE_NAME_PATTERN, 'u')

/** One forwarder selects direct accepted targets; it holds no providers, sessions or pending table. */
export class Forwarder {
  /** Lookup and operation ports are supplied by the actual root owners. */
  readonly #ports: IForwarderOptions
  /** This host admits its own finite ceiling once, before any transport resource opens. */
  readonly #maxHops: number
  /** Character edges preserve longest peer-name selection in O(method length), even on a miss. */
  readonly #prefix: IForwardPrefix = { children: new Map(), references: 0, namespaces: new Map() }
  /** Retirement owns only compact names; no accepted Session or second method directory is retained. */
  readonly #contributions = new Map<string, Readonly<{ namespace: string; name: string }>>()

  /** Capture explicit collaborators without creating another peer facade. */
  constructor(ports: IForwarderOptions) {
    this.#ports = ports
    this.#maxHops = ports.maxHops === undefined ? 3 : ports.maxHops
    if (
      !Number.isInteger(this.#maxHops) ||
      this.#maxHops < 1 ||
      this.#maxHops > RpcWireLimit.maxForwardHops
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, ForwardErrorText.maxHopsInvalid)
  }

  /** Register one accepted peer spelling; business methods stay solely in its accepted directory. */
  accepted(selection: IForwardSelection): void {
    this.retired(selection.carrierId)
    /** The established automatic prefix grammar is checked only at cold directory admission. */
    const name = selection.view.name
    if (!name.split('.').every((part) => namespaceSegment.test(part))) return
    /** Character edges retain known spellings; only the exact terminal counts live sources. */
    let node = this.#prefix
    for (const character of name) {
      /** Each key lookup is constant time; no peer collection is searched or copied. */
      let child = node.children.get(character)
      if (!child) {
        child = { children: new Map(), references: 0, namespaces: new Map() }
        node.children.set(character, child)
      }
      node = child
    }
    node.references++
    node.name = name
    node.namespaces.set(
      selection.view.namespace,
      (node.namespaces.get(selection.view.namespace) ?? 0) + 1
    )
    this.#contributions.set(selection.carrierId, { namespace: selection.view.namespace, name })
  }

  /** Project accepted method metadata only at directory output; dispatch keeps its single index. */
  describe(
    local: readonly IRpcMethodDescription[],
    targets: Iterable<IForwardSelection>
  ): readonly IRpcMethodDescription[] {
    /** Original local registration order and exact-name precedence survive automatic forwarding. */
    const methods = [...local]
    /** This output-sized set prevents collisions without another persistent business-method table. */
    const names = new Set(local.map((method) => method.name))
    for (const selection of targets) {
      if (!this.#contributions.has(selection.carrierId)) continue
      for (const method of selection.view.methods.values()) {
        /** Prefixing materializes only the actual public directory entry being emitted. */
        const name = `${selection.view.name}.${method.name}`
        if (name.length > RpcWireLimit.maxIdentifierChars || names.has(name)) continue
        names.add(name)
        /** A dotted peer name is routable but cannot occupy the protocol's single-segment hint. */
        const { forwardedVia: _previous, ...description } = method
        methods.push(Object.freeze({ ...description, name, ...forwardHint(selection.view.name) }))
      }
    }
    return Object.freeze(methods)
  }

  /** Withdraw the exact source's spelling without scanning unrelated peers or method entries. */
  retired(carrierId: string): void {
    /** Directory updates and carrier retirement share this sole compact contribution receipt. */
    const contribution = this.#contributions.get(carrierId)
    if (!contribution) return
    this.#contributions.delete(carrierId)
    /** Known peer spellings survive departure so an offline route differs from a local method. */
    let node = this.#prefix
    for (const character of contribution.name) {
      /** The same original trie retains no Session or provider objects after its live count drops. */
      const child = node.children.get(character)!
      node = child
    }
    node.references--
    /** A zero count retains only historical name membership, not a selectable direct source. */
    const remaining = node.namespaces.get(contribution.namespace)! - 1
    node.namespaces.set(contribution.namespace, remaining)
  }

  /** Resolve the longest admitted peer prefix before checking its method, including missing methods. */
  resolveEntry(
    namespace: string,
    fullMethod: string,
    source?: IRpcFlowContext,
    envelope?: IRpcEnvelope
  ): IProviderForwardEntry | undefined {
    /** One text traversal is linear in the bounded method spelling, independent of peer count. */
    const prefix = this.#peerPrefix(namespace, fullMethod)
    if (!prefix) return undefined
    try {
      /** Canonical Session admission selects current namespace first and rejects global ambiguity. */
      const current = this.#ports.resolve(namespace, prefix)
      if (!current)
        throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
      /** This single substring is materialized only after the target has been selected and admitted. */
      const method = fullMethod.slice(prefix.length + 1)
      /** The accepted method map is the only business lookup index. */
      const description = current.view.methods.get(method)
      if (!description)
        throw createRpcError(
          RpcCoreErrorCode.providerNotFound,
          RuntimeApiErrorText.methodUnavailable
        )
      return this.#entry(current, description, fullMethod)
    } catch (error) {
      if (source && envelope) this.reject(source, envelope, error)
      throw error
    }
  }

  /** Lookup or mode admission may refuse forwarding before any downstream invocation exists. */
  reject(source: IRpcFlowContext, envelope: IRpcEnvelope, error: unknown): void {
    if (!this.#ports.observation?.facts(source.namespace).observing) return
    /** Failed admission has no later invocation; publish its one arrival and actual refusal here. */
    const route = envelope.route.forwardRoute ?? [this.#origin(source)!]
    this.#observe(source, envelope, route, RpcProbeOutcome.received)
    this.#rejected(source, envelope, route, error)
  }

  /** Root shutdown releases compact routing spellings; SessionTable owns every physical resource. */
  close(): void {
    this.#prefix.children.clear()
    this.#contributions.clear()
  }

  /** Select one longest local prefix, then one longest global prefix, without allocating prefixes. */
  #peerPrefix(namespace: string, method: string): string | undefined {
    /** A missing edge stops Map work while the same pass still recognizes a qualified miss. */
    let node: IForwardPrefix | undefined = this.#prefix
    /** Namespace-local target presence takes priority over any target in another namespace. */
    let local: string | undefined
    /** Global resolution stays under SessionTable's canonical same-name ambiguity decision. */
    let global: string | undefined
    /** Historical membership is used only when no live prefix can route this method. */
    let knownLocal: string | undefined
    /** An offline global spelling still differs from a method that was never a peer route. */
    let knownGlobal: string | undefined
    for (const character of method) {
      if (character === '.') {
        if (node?.namespaces.size) {
          knownGlobal = node.name
          if (node.namespaces.has(namespace)) knownLocal = node.name
          if (node.references > 0) global = node.name
          if ((node.namespaces.get(namespace) ?? 0) > 0) local = node.name
        }
      }
      node = node?.children.get(character)
    }
    return local ?? global ?? knownLocal ?? knownGlobal
  }

  /** Compact metadata has no callable/provider object and no mutable accepted Session view. */
  #entry(
    selection: IForwardSelection,
    description: IRpcMethodDescription,
    name: string
  ): IProviderForwardEntry {
    return Object.freeze({
      kind: 'forward',
      name,
      method: description.name,
      namespace: selection.view.namespace,
      targetName: selection.view.name,
      held: callTarget(selection),
      description,
      supportedModes: description.supportedModes
    })
  }

  /** Capture an original accepted binding; later same-name replacement cannot revive the callable. */
  hold(selection: IForwardSelection, description: IRpcMethodDescription): IProviderMethodCallable {
    /** Only scalar accepted facts survive capability construction. */
    const target = callTarget(selection)
    /**
     * Metadata belongs to this exact callable so descriptor compilation retains forwarding
     * identity.
     */
    const entry: IProviderForwardEntry = Object.freeze({
      kind: 'forward',
      name: description.name,
      method: description.name,
      namespace: target.namespace,
      targetName: target.name,
      held: target,
      description,
      supportedModes: description.supportedModes
    })
    /** The local capability and forwarded provider share this same compact binding. */
    const context = { owner: this, entry }
    /** Scalar capability errors keep their rejected Promise; stream capabilities return iterators. */
    const invoke: IProviderMethodCallable = (payload, options) =>
      context.owner.#direct(context.entry, payload, options)
    return retainProviderForwardMethod(
      description.supportedModes.every((mode) => mode === RpcCallMode.stream)
        ? invoke
        : async (payload, options) => invoke(payload, options),
      entry
    )
  }

  /**
   * Forward one request/notify over the original selected direct session with inherited elapsed
   * budget.
   */
  invoke(
    entry: IProviderForwardEntry,
    context: IRpcContext,
    source: IRpcFlowContext,
    incomingMode?: 'request' | 'notify',
    options: IRpcCallOptions = {},
    envelope?: IRpcEnvelope
  ): Promise<unknown> {
    /** Mode selection comes from the admitted task, never inferred from the payload. */
    const mode = entry.supportedModes.every((mode) => mode === RpcCallMode.notify)
      ? RpcCallMode.notify
      : (incomingMode ?? RpcCallMode.request)
    /** Admission and route observations precede the actual existing CallTable operation. */
    const local = this.#options(entry, context, source, options, envelope)
    return this.#ports.call(
      this.#select(entry),
      {
        mode,
        method: entry.method,
        ...(context.data === undefined ? {} : { payload: context.data as IRpcPortableValue })
      },
      local
    )
  }

  /** A group remains a single fail-stop downstream operation; only method names are remapped. */
  async group(
    entries: readonly IProviderForwardEntry[],
    steps: readonly IRpcStep[],
    context: IRpcContext,
    source: IRpcFlowContext,
    options: IRpcCallOptions = {},
    envelope?: IRpcEnvelope
  ): Promise<IRpcPortableValue> {
    /** The dispatcher already admitted one local/forward target for every original member. */
    const first = entries[0]!
    /** One group is one physical forward, regardless of its number of member methods. */
    const local = this.#options(first, context, source, options, envelope)
    return (await this.#ports.call(
      this.#select(first),
      {
        mode: RpcCallMode.group,
        steps: steps.map((step, index) => ({ ...step, method: entries[index]!.method }))
      },
      local
    )) as IRpcPortableValue
  }

  /** Streaming relays retain the sole downstream lazy iterator and single-credit owner. */
  stream(
    entry: IProviderForwardEntry,
    context: IRpcContext,
    source: IRpcFlowContext,
    options: IRpcCallOptions = {},
    envelope?: IRpcEnvelope
  ): AsyncIterableIterator<IRpcPortableValue> {
    /** The original lazy consumer owns handoff and releases this callback with its input options. */
    const local = this.#options(entry, context, source, options, envelope)
    return this.#ports.stream(
      this.#select(entry),
      entry.method,
      context.data as IRpcPortableValue | undefined,
      local
    )
  }

  /**
   * Local held capabilities use ordinary origin policies while provider transit always sets origin
   * false.
   */
  #direct(
    entry: IProviderForwardEntry,
    payload?: IRpcPortableValue,
    options?: ICallLocalOptions
  ): unknown {
    /** Method presence is rechecked on the original accepted binding before every physical attempt. */
    const target = this.#select(entry)
    if (entry.supportedModes.every((mode) => mode === RpcCallMode.stream))
      return this.#ports.stream(target, entry.method, payload, options)
    return this.#ports.call(
      target,
      {
        mode: entry.supportedModes.every((mode) => mode === RpcCallMode.notify)
          ? RpcCallMode.notify
          : RpcCallMode.request,
        method: entry.method,
        ...(payload === undefined ? {} : { payload })
      },
      options
    )
  }

  /** Current-namespace then unique-global resolution belongs to SessionTable's canonical indexes. */
  #select(entry: IProviderForwardEntry): ICallTargetRef {
    /** Held capability references cannot retarget a successor with the same display name. */
    const selection = entry.held
      ? this.#ports.current(entry.held.carrierId)
      : this.#ports.resolve(entry.namespace, entry.targetName)
    if (
      !selection ||
      (entry.held &&
        (selection.view.peerId !== entry.held.peerId ||
          !sameGeneration(selection.view.generation, entry.held.generation)))
    )
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    if (!selection.view.methods.has(entry.method))
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    return callTarget(selection)
  }

  /** Each hop appends only its own node and intersects the original elapsed budget downstream. */
  #options(
    entry: IProviderForwardEntry,
    context: IRpcContext,
    source: IRpcFlowContext,
    options: IRpcCallOptions,
    envelope?: IRpcEnvelope
  ): ICallLocalOptions {
    /** The first native forwarding route derives its origin from the accepted source directory. */
    const origin = this.#origin(source)
    if (!context.route && !origin)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RuntimeApiErrorText.forwardOriginUnavailable
      )
    /** The same required route is borrowed for observations; absence of observers creates no events. */
    const route = context.route ?? [origin!]
    /** One namespace check dominates all forward event construction and handoff callback allocation. */
    const observing = this.#ports.observation?.facts(source.namespace).observing ?? false
    if (observing && envelope) this.#observe(source, envelope, route, RpcProbeOutcome.received)
    try {
      /** Resolve through the same direct identity before constructing this hop's bounded proof. */
      const target = this.#select(entry)
      /** Routing, loop and hop admission all complete before any physical downstream operation. */
      const nextRoute = forwardRoute(
        route,
        this.#ports.nodeId(),
        this.#maxHops,
        this.#ports.sourceNodeId(target.carrierId)
      )
      /** Only an active observer retains these actual hop facts until physical handoff. */
      const observation = observing && envelope ? { source, envelope, route: nextRoute } : undefined
      return {
        ...options,
        signal: context.signal,
        ...(context.trace === undefined ? {} : { trace: context.trace }),
        remainingMs: context.timeoutMs,
        forwardRoute: nextRoute,
        ...(observation
          ? {
              onWriteStart: () =>
                this.#observe(
                  observation.source,
                  observation.envelope,
                  observation.route,
                  RpcProbeOutcome.sent
                )
            }
          : {}),
        origin: false
      }
    } catch (error) {
      if (observing && envelope) this.#rejected(source, envelope, route, error)
      throw error
    }
  }

  /** Only accepted source facts may supply the first route node. */
  #origin(source: IRpcFlowContext): string | undefined {
    return source.session?.nodeId ?? this.#ports.sourceNodeId(source.carrierId)
  }

  /** Emit only actual Forwarder refusals, preserving the original public error unchanged. */
  #rejected(
    source: IRpcFlowContext,
    envelope: IRpcEnvelope,
    route: readonly string[],
    error: unknown
  ): void {
    /** Known owner errors select the existing reason vocabulary without guessing business failures. */
    const code = (error as { code?: string } | null)?.code
    /** Forward reason is independent from diagnostic error serialization. */
    const reason =
      code === RpcCoreErrorCode.forwardLoop
        ? RpcProbeForwardRejection.loop
        : code === RpcCoreErrorCode.forwardHopLimit
          ? RpcProbeForwardRejection.hopLimit
          : code === RpcCoreErrorCode.targetUnknown
            ? RpcProbeForwardRejection.targetUnknown
            : code === RpcCoreErrorCode.providerNotFound
              ? RpcProbeForwardRejection.methodUnavailable
              : undefined
    if (reason) this.#observe(source, envelope, route, RpcProbeOutcome.rejected, reason)
  }

  /** Guarded callers alone publish borrowed route facts through the existing flow observer. */
  #observe(
    source: IRpcFlowContext,
    envelope: IRpcEnvelope,
    route: readonly string[],
    outcome: RpcProbeOutcome,
    rejection?: RpcProbeForwardRejection
  ): void {
    this.#ports.observation!.observe({
      kind: RpcProbeObservationKind.event,
      namespace: source.namespace,
      carrierId: source.carrierId,
      data: {
        ...rpcProbeEnvelopeFacts(envelope),
        stage: RpcProbeStage.forward,
        direction:
          outcome === RpcProbeOutcome.sent ? RpcProbeDirection.outbound : RpcProbeDirection.inbound,
        outcome,
        hop: route.length - (outcome === RpcProbeOutcome.sent ? 1 : 0),
        maxHops: this.#maxHops,
        route,
        rejection
      }
    })
  }
}
