/**
 * Compile the fixed intervention order once; optional plugins retain their own algorithms and
 * resources.
 */
import type {
  IRpcDispatchContext,
  IRpcDispatchOutcome,
  IRpcFlowContext,
  IRpcFlowHooks,
  IRpcFlowPluginDefinition,
  IRpcFrameNext,
  IRpcFrameWriteOptions,
  IRpcObservation,
  IRpcCarrierFrame,
  IRpcPreparedMessage,
  IRpcEnvelopeContext
} from '@migaia/rpc-contract/interfaces'
import type { IRpcHandshake } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.js'

/** Each namespace borrows one immutable installation prefix in both traversal directions. */
type ICompiledFlow = Readonly<{
  outbound: readonly IRpcFlowHooks[]
  inbound: readonly IRpcFlowHooks[]
  extensions: ReadonlySet<string>
  required: ReadonlySet<string>
  observationFacts?: IRpcFlowPluginDefinition['observationFacts']
}>

/** A registered scope stores membership once instead of rescanning namespace arrays on calls. */
type IFlowRegistration = Readonly<{
  definition: IRpcFlowPluginDefinition
  namespaces?: ReadonlySet<string>
}>

/** A frame plugin may emit several next frames; every continuation retains the actual write Promise. */
class FrameRun {
  /** Fixed direction order is borrowed from the namespace's compiled installation. */
  readonly #hooks: readonly IRpcFlowHooks[]
  /** This operation's accepted facts and cancellation remain explicit. */
  readonly #context: IRpcFlowContext
  /** The Session supplies decode/restore or the actual physical write as the terminal. */
  readonly #terminal: IRpcFrameNext

  /** Capture only operation-local ports; no carrier or message is stored in the installation. */
  constructor(hooks: readonly IRpcFlowHooks[], context: IRpcFlowContext, terminal: IRpcFrameNext) {
    this.#hooks = hooks
    this.#context = context
    this.#terminal = terminal
  }

  /** Advance one fixed stage; chunks/batches reenter the remaining suffix without changing order. */
  async invoke(index: number, value: IRpcCarrierFrame, write = this.#context.write): Promise<void> {
    while (index < this.#hooks.length) {
      /** Only the fixed directional frame slot can take ownership of this continuation. */
      const hook = this.#hooks[index++]!.frame?.[this.#context.direction]
      if (hook)
        return hook(value, this.#frameContext(write), (frame, nextWrite) =>
          this.invoke(index, frame, nextWrite === undefined ? write : nextWrite)
        )
    }
    return this.#terminal(value, write)
  }

  /** Replaced physical options follow the same suffix without borrowing the first batch member. */
  #frameContext(write: IRpcFrameWriteOptions | undefined): IRpcFlowContext {
    if (write === this.#context.write) return this.#context
    return {
      ...this.#context,
      write,
      signal:
        write?.signal === false
          ? (this.#context.connectionSignal ?? this.#context.signal)
          : (write?.signal ?? this.#context.signal)
    }
  }
}

/** Provider continuations are single-use; replay plugins return a result without invoking them. */
class DispatchNext {
  /** The remaining chain belongs to this actual dispatch, never the installation. */
  readonly #run: DispatchRun
  /** This continuation's suffix is fixed before invoking the current plugin. */
  readonly #index: number
  /** Duplicate next invocation must never execute the business method twice. */
  #used = false

  /** Give one plugin one continuation over its already selected suffix. */
  constructor(run: DispatchRun, index: number) {
    this.#run = run
    this.#index = index
  }

  /** Reject repeated execution while leaving replay/short-circuit outcomes under the plugin owner. */
  readonly invoke = (): Promise<IRpcDispatchOutcome> => {
    if (this.#used)
      return Promise.reject(
        tagRpcError(
          new TypeError(HostErrorText.dispatchNextRepeated),
          RpcCoreErrorCode.contractInvalid
        )
      )
    this.#used = true
    return this.#run.invoke(this.#index)
  }
}

/** Own one dispatch chain; provider completion and cancellation remain with ProviderDispatcher. */
class DispatchRun {
  /** Incoming hooks execute in the reverse of their native installation order. */
  readonly #hooks: readonly IRpcFlowHooks[]
  /** Completion settles only at the actual business terminal, including stream cleanup. */
  readonly #context: IRpcDispatchContext
  /** This port performs the real provider call exactly once when the chain reaches it. */
  readonly #terminal: () => Promise<IRpcDispatchOutcome>

  /** Retain the narrow provider port rather than a whole host or mutable dispatcher table. */
  constructor(
    hooks: readonly IRpcFlowHooks[],
    context: IRpcDispatchContext,
    terminal: () => Promise<IRpcDispatchOutcome>
  ) {
    this.#hooks = hooks
    this.#context = context
    this.#terminal = terminal
  }

  /** Each stage either returns its own outcome or invokes its single-use next continuation. */
  invoke(index: number): Promise<IRpcDispatchOutcome> {
    while (index < this.#hooks.length) {
      /** Fixed slots avoid arbitrary callback names or runtime middleware registration. */
      const hook = this.#hooks[index++]!.dispatch?.inbound
      if (hook) return hook(this.#context, new DispatchNext(this, index).invoke)
    }
    return this.#terminal()
  }
}

/** Own only fixed stage composition, extension membership, and readonly event distribution. */
export class FlowPipeline {
  /** Native install order is preserved exactly by this cold registration list. */
  readonly #registrations = new Map<IRpcFlowPluginDefinition, IFlowRegistration>()
  /** Namespace compilation is cold and cached, including namespaces installed on an ordinary host. */
  readonly #scopes = new Map<string, ICompiledFlow>()
  /** The first transport startup freezes the already installed intervention prefix. */
  #started = false
  /** Uncorrelated observer failures are delivered to the owning host's reporter. */
  readonly #report: (error: unknown) => void

  /** The host supplies reporting; this owner has no concrete optional plugin dependencies. */
  constructor(report: (error: unknown) => void) {
    this.#report = report
  }

  /** Only native installation can register hooks, before any transport begins processing traffic. */
  register(definition: IRpcFlowPluginDefinition): () => void {
    if (this.#started)
      throw tagRpcError(new TypeError(HostErrorText.flowStarted), RpcCoreErrorCode.invalidConfig)
    this.#registrations.set(definition, {
      definition,
      namespaces: definition.namespaces === undefined ? undefined : new Set(definition.namespaces)
    })
    this.#scopes.clear()
    return () => {
      this.#registrations.delete(definition)
      this.#scopes.clear()
    }
  }

  /** A failed first native batch may retry before any transport has ever committed. */
  reopenBeforeStartup(): void {
    this.#started = false
    this.#scopes.clear()
  }

  /** Freeze the installation prefix; existing scopes retain their one compiled hook order. */
  start(): void {
    this.#started = true
  }

  /** Propose only extension handlers actually installed for this namespace. */
  extensions(namespace: string): readonly string[] {
    return [...this.#scope(namespace).extensions]
  }

  /** Required extension negotiation belongs to Session, using this installed membership only. */
  requiredExtensions(namespace: string): readonly string[] {
    return [...this.#scope(namespace).required]
  }

  /** Apply handshake plugins in fixed direction order before host identity/directory admission. */
  async handshake(value: IRpcHandshake, context: IRpcFlowContext): Promise<IRpcHandshake> {
    for (const hooks of this.#ordered(context))
      if (hooks.handshake) value = await hooks.handshake(value, context)
    return value
  }

  /** Prepared metadata is protected before encoding and admitted before native restoration. */
  async envelope(
    value: IRpcPreparedMessage,
    context: IRpcEnvelopeContext
  ): Promise<IRpcPreparedMessage> {
    for (const hooks of this.#ordered(context)) {
      /** The context's actual direction selects one of the two fixed envelope slots. */
      const hook = hooks.envelope?.[context.direction]
      if (hook) value = await hook(value, context)
    }
    return value
  }

  /** Preserve actual downstream completion through zero/many frame transformations. */
  frame(value: IRpcCarrierFrame, context: IRpcFlowContext, next: IRpcFrameNext): Promise<void> {
    return new FrameRun(this.#ordered(context), context, next).invoke(0, value)
  }

  /** Optional admission/replay policies surround the single actual provider execution. */
  dispatch(
    context: IRpcDispatchContext,
    next: () => Promise<IRpcDispatchOutcome>
  ): Promise<IRpcDispatchOutcome> {
    return new DispatchRun(this.#ordered(context), context, next).invoke(0)
  }

  /** Observe in installation order; isolate a failed observer and report its original failure. */
  readonly observe = (event: IRpcObservation): void => {
    for (const registration of this.#registrations.values()) {
      if (
        event.namespace !== undefined &&
        registration.namespaces &&
        !registration.namespaces.has(event.namespace)
      )
        continue
      /** Observers receive a readonly event; none can replace the business continuation. */
      const observer = registration.definition.hooks.observe
      if (!observer) continue
      try {
        observer(event)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  /** Cold native startup borrows the actual compiled hook set, with no separate observer registry. */
  observing(namespace: string): boolean {
    return this.#scope(namespace).outbound.some((hooks) => hooks.observe !== undefined)
  }

  /** Read only the actual installed owner's facts from this namespace's existing compiled scope. */
  observationFacts(namespace: string): IRpcFlowPluginDefinition['observationFacts'] {
    return this.#scope(namespace).observationFacts
  }

  /** Release plugin callback references after the host's actual installation cleanup finishes. */
  close(): void {
    this.#registrations.clear()
    this.#scopes.clear()
  }

  /** Direction selection is O(1); each actual hook traversal is linear in installed stages. */
  #ordered(context: IRpcFlowContext): readonly IRpcFlowHooks[] {
    return this.#scope(context.namespace)[context.direction]
  }

  /** Compile namespace scope and extension membership once, preserving installation order. */
  #scope(namespace: string): ICompiledFlow {
    /** Later ordinary-host transports can use the same frozen flow prefix without another host. */
    const existing = this.#scopes.get(namespace)
    if (existing) return existing
    /** Cold hooks are selected once; calls do not scan namespace scope declarations. */
    const outbound: IRpcFlowHooks[] = []
    /** Actual extension names have a single membership index for negotiation. */
    const extensions = new Set<string>()
    /** Required membership is checked by the shared handshake algorithm. */
    const required = new Set<string>()
    /** Only selected genuine installations may describe their protection mode. */
    let observationFacts: IRpcFlowPluginDefinition['observationFacts']
    for (const registration of this.#registrations.values()) {
      if (registration.namespaces && !registration.namespaces.has(namespace)) continue
      outbound.push(registration.definition.hooks)
      observationFacts = registration.definition.observationFacts ?? observationFacts
      for (const name of registration.definition.extensions ?? []) extensions.add(name)
      for (const name of registration.definition.requiredExtensions ?? []) required.add(name)
    }
    /** Reverse only the cold array; inbound execution itself performs no copying or sorting. */
    const compiled = {
      outbound,
      inbound: [...outbound].reverse(),
      extensions,
      required,
      observationFacts
    }
    this.#scopes.set(namespace, compiled)
    return compiled
  }
}
