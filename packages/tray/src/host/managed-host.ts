/**
 * Owns the managed facade publication barrier, mutations and cached logical disposal receipt. The
 * existing Graph and PluginHost composition remain the only topology and resource owners.
 */
import { mergeCleanupResults } from '@migaia/lifecycle'
import { CapabilityGraphNodeState } from '@migaia/capability/graph'
import { createEventHub, type IEventContext } from '@migaia/event-subscriber'
import {
  asyncDisposeKey,
  type IPluginAdmission,
  type IPluginConstraint,
  type IPluginDataOrderSlot,
  type IPluginHostDisposalResult
} from '@migaia/plugin-host'
import {
  openComposition,
  type IPluginHostCompositionIntegration
} from '@migaia/plugin-host/composition'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import {
  TrayHostState,
  type ITrayHostDisposalResult,
  type ITrayHostEventMap,
  type ITrayHostState,
  type ITrayPluginMutationResult,
  type ITrayPluginRemovalResult,
  type ITrayPluginPhysicalCleanupResult,
  type IUnsubscribe
} from './typing.ts'
import { claimArtifactCustody, readRuntimeBridge } from './internal-capability.ts'
import { admitTrayPlugin, toGraphNode } from './admission.ts'
import {
  mutationResult,
  mutationFailure,
  removalResult,
  removalMissing,
  removalFailure
} from './mutation-results.ts'
import { LogicalCleanupWait } from './cleanup-wait.ts'
import { claims } from './host-claims.ts'
import { ManagedHostEvent, ManagedHostOperation, ManagedHostTermination } from './constants.ts'
import type {
  IAdmissionRecord,
  IGraphId,
  IManagedTrayHostContext,
  IPluginBinding,
  IPluginSnapshot
} from './host-context.ts'

/** One managed Host owns publication state, mutation admission and its cached disposal receipt. */
export class ManagedTrayHost {
  /** References point to the same concrete Host, Graph and startup session. */
  #context: IManagedTrayHostContext
  /** The original concrete Host alone owns plugin installation and data slots. */
  #composition: IPluginHostCompositionIntegration<object>
  /** Managed mutation admission stops synchronously when disposal starts. */
  #state: ITrayHostState = TrayHostState.active
  /** Terminal failure remains available without replacing its identity. */
  #terminalError: unknown
  /** Reentrant disposal observers receive this exact shared promise. */
  #disposal: Promise<ITrayHostDisposalResult> | undefined
  /** Reads fail closed while Host and Graph generations converge. */
  #publicationPending = false
  /** One event hub publishes settled mutation and disposal outcomes. */
  #hub: ReturnType<typeof createEventHub<ITrayHostEventMap>>

  /** Borrow canonical owners after startup has acquired its sole managed claim. */
  constructor(context: IManagedTrayHostContext) {
    this.#context = context
    this.#composition = openComposition(context.concrete as object)
    this.#hub = createEventHub<ITrayHostEventMap>({
      report: ({ error }) => {
        try {
          context.options.report?.(error)
        } catch {
          /* Reporting cannot alter a settled mutation. */
        }
      }
    })
  }

  /** Read the currently owned graph names only after publication converges. */
  get plugins() {
    this.#assertReadable()
    return Object.freeze(this.#context.graph.nodes.map(String))
  }
  /** Project only graph nodes in the canonical ready state. */
  get readyPlugins() {
    this.#assertReadable()
    /** Graph snapshots already preserve registration order; project ready names in one pass. */
    const ready: string[] = []
    for (const id of this.#context.graph.nodes) {
      if (this.#context.graph.nodeState(id).state === CapabilityGraphNodeState.ready)
        ready.push(String(id))
    }
    return Object.freeze(ready)
  }
  /** Expose managed admission state without granting mutation authority. */
  get state() {
    return this.#state
  }
  /** Report whether managed mutations may still be admitted. */
  get isActive() {
    return this.#state === TrayHostState.active
  }
  /** Retain the original terminal failure for diagnostic callers. */
  get error() {
    return this.#terminalError
  }
  /** Expose extensions from the exact current composition snapshot. */
  get extensions() {
    this.#assertReadable()
    return this.#context.readSnapshot().extensions
  }
  /** Lend the current config projection while publishing its next composition revision after writes. */
  get config() {
    this.#assertReadable()
    /** Each config facade retains the original snapshot receiver for get and update. */
    const config = this.#context.readSnapshot().config
    return {
      get: (path: string) => config.get(path),
      update: async (
        name: string,
        recipe: (previous: Readonly<Record<string, unknown>>) => Record<string, unknown>
      ) => {
        await config.update(name, recipe as never)
        this.#context.writeSnapshot(this.#context.readSnapshot())
      }
    }
  }
  /** Map canonical graph state to the existing absent-node blocked result. */
  pluginState = (name: string) => {
    this.#assertReadable()
    try {
      return this.#context.graph.nodeState(name as IGraphId).state
    } catch {
      return CapabilityGraphNodeState.blocked
    }
  }
  /** Subscribe through the one managed event hub, preserving listener settlement. */
  on = <TKey extends keyof ITrayHostEventMap>(
    type: TKey,
    listener: (event: IEventContext<ITrayHostEventMap[TKey]>) => void | PromiseLike<void>
  ): IUnsubscribe => {
    return this.#hub.subscribe(type, listener as never)
  }
  /** Register one canonical admission and publish only its settled graph outcome. */
  use = async (
    plugin: IPluginBinding
  ): Promise<ITrayPluginMutationResult<unknown, unknown, unknown>> => {
    this.#assertActive()
    this.#context.assertOwned()
    /** Validate and capture before entering the graph mutation result channel. */
    const { snapshot, admission } = admitTrayPlugin(plugin, this.#composition)
    /** The admitted snapshot owns the immutable target name for this mutation. */
    const name = snapshot.name
    /** Every admitted node, including blocked ones, owns a binding in the Graph's name index. */
    const existedBefore = this.#context.graph.getBinding(name as IGraphId) !== undefined
    /** A provisional candidate becomes owned only if Graph commit selects its exact identity. */
    let candidate: IAdmissionRecord | undefined
    try {
      this.#resetCleanup()
      candidate = this.#createAdmissionRecord(plugin, snapshot, admission)
      this.#publicationPending = true
      /** The canonical owner settles this operation before its observation is published. */
      const result = await this.#context.graph.register(toGraphNode(candidate), candidate)
      this.#publicationPending = false
      /** The frozen success observation retains this exact managed facade and cleanup snapshot. */
      const output = mutationResult(
        ManagedHostOperation.use,
        name,
        result.affected.map(String),
        result.topologyChanged,
        this,
        this.#context.cleanup
      )
      this.#hub.publish(ManagedHostEvent.use, output as never)
      this.#hub.publish(ManagedHostEvent.registered, output as never)
      return output
    } catch (error) {
      this.#publicationPending = false
      /** Only canonical Graph membership determines whether a failed mutation committed. */
      const committed =
        candidate !== undefined &&
        !existedBefore &&
        this.#context.graph.getBinding(name as IGraphId) === candidate
      if (candidate && !committed) {
        this.#composition!.retireDataOrderSlot(candidate.slot)
        await candidate.artifactCustody?.rollback()
      }
      /** Publish the original failure observation without changing its error identity. */
      const failure = mutationFailure(ManagedHostOperation.use, name, error, this, committed)
      this.#hub.publish(ManagedHostEvent.mutationFailed, {
        operation: ManagedHostOperation.use,
        name,
        error: failure.error
      })
      return failure
    }
  }
  /** Remove one exact generation after enforcing Runtime reentrancy and ownership fences. */
  unUse = async (name: string): Promise<ITrayPluginRemovalResult<unknown, unknown>> => {
    this.#assertActive()
    this.#context.assertOwned()
    /** The exact Host bridge enforces synchronous same-run mutation restrictions. */
    const runtimeBridge = readRuntimeBridge(this)
    try {
      runtimeBridge?.assertMutationAllowed?.(name)
    } catch (error) {
      /** Publish the original failure observation without changing its error identity. */
      const failure = removalFailure(name, error, this)
      this.#hub.publish(ManagedHostEvent.mutationFailed, {
        operation: ManagedHostOperation.unUse,
        name,
        error: failure.error
      })
      return failure
    }
    if (this.#context.graph.getBinding(name as IGraphId) === undefined)
      return removalMissing(name, this)
    /** Retain the original generation so only its data-order slot is retired after removal. */
    const target = this.#context.graph.getBinding<IAdmissionRecord>(name as IGraphId)
    try {
      this.#resetCleanup()
      this.#publicationPending = true
      /** The canonical owner settles this operation before its observation is published. */
      const result = await this.#context.graph.remove(name as IGraphId)
      this.#publicationPending = false
      if (target) this.#composition!.retireDataOrderSlot(target.slot)
      /** The frozen success observation retains this exact managed facade and cleanup snapshot. */
      const output = removalResult(name, result.affected.map(String), this, this.#context.cleanup)
      this.#hub.publish(ManagedHostEvent.unUse, output as never)
      this.#hub.publish(ManagedHostEvent.removed, output as never)
      return output
    } catch (error) {
      this.#publicationPending = false
      /** Only canonical Graph membership determines whether a failed mutation committed. */
      const committed = this.#context.graph.getBinding(name as IGraphId) === undefined
      /** Publish the original failure observation without changing its error identity. */
      const failure = removalFailure(name, error, this, committed)
      this.#hub.publish(ManagedHostEvent.mutationFailed, {
        operation: ManagedHostOperation.unUse,
        name,
        error: failure.error
      })
      return failure
    }
  }
  /** Replace a captured admission without weakening the existing generation on admission failure. */
  replace = async (
    plugin: IPluginBinding
  ): Promise<ITrayPluginMutationResult<unknown, unknown, unknown>> => {
    this.#assertActive()
    this.#context.assertOwned()
    /** Invalid replacements reject while their existing generation still serves. */
    const { snapshot, admission } = admitTrayPlugin(plugin, this.#composition)
    /** The admitted snapshot owns the immutable target name for this mutation. */
    const name = snapshot.name
    /** The exact Host bridge enforces synchronous same-run mutation restrictions. */
    const runtimeBridge = readRuntimeBridge(this)
    try {
      runtimeBridge?.assertMutationAllowed?.(name)
    } catch (error) {
      /** Publish the original failure observation without changing its error identity. */
      const failure = mutationFailure(ManagedHostOperation.replace, name, error, this)
      this.#hub.publish(ManagedHostEvent.mutationFailed, {
        operation: ManagedHostOperation.replace,
        name,
        error: failure.error
      })
      return failure
    }
    /** A replacement reuses the currently admitted definition slot without reordering it. */
    const previous = this.#context.graph.getBinding<IAdmissionRecord>(name as IGraphId)
    /** A provisional candidate becomes owned only if Graph commit selects its exact identity. */
    let candidate: IAdmissionRecord | undefined
    try {
      this.#resetCleanup()
      candidate = this.#createAdmissionRecord(plugin, snapshot, admission, previous?.slot)
      this.#publicationPending = true
      /** The canonical owner settles this operation before its observation is published. */
      const result = await this.#context.graph.replace(toGraphNode(candidate), candidate)
      this.#publicationPending = false
      /** The frozen success observation retains this exact managed facade and cleanup snapshot. */
      const output = mutationResult(
        ManagedHostOperation.replace,
        name,
        result.affected.map(String),
        result.topologyChanged,
        this,
        this.#context.cleanup
      )
      this.#hub.publish(ManagedHostEvent.replace, output as never)
      this.#hub.publish(ManagedHostEvent.replaced, output as never)
      return output
    } catch (error) {
      this.#publicationPending = false
      /** Only canonical Graph membership determines whether a failed mutation committed. */
      const committed =
        candidate !== undefined && this.#context.graph.getBinding(name as IGraphId) === candidate
      /** Publish the original failure observation without changing its error identity. */
      const failure = mutationFailure(ManagedHostOperation.replace, name, error, this, committed)
      this.#hub.publish(ManagedHostEvent.mutationFailed, {
        operation: ManagedHostOperation.replace,
        name,
        error: failure.error
      })
      return failure
    }
  }
  /** Publish one disposal receipt before any reentrant observer can request disposal again. */
  dispose = (): Promise<ITrayHostDisposalResult> => {
    if (this.#disposal) return this.#disposal
    this.#state = TrayHostState.closing
    // Publish completion identity before invoking any reentrant disposing observer.
    this.#disposal = Promise.resolve().then(this.#disposeOnce)
    this.#hub.publish(ManagedHostEvent.disposing, { state: TrayHostState.closing })
    return this.#disposal
  };
  /** Join the same canonical disposal receipt for asynchronous using. */
  [asyncDisposeKey] = () => {
    return this.dispose().then(() => undefined)
  }
  /** Reject mutations after terminal admission has begun. */
  #assertActive(): void {
    if (this.#state !== TrayHostState.active) throw createTrayError(TrayErrorCode.unavailable)
  }

  /** Rejects observations that could otherwise combine different Host and Graph generations. */
  #assertReadable(): void {
    if (this.#publicationPending) throw createTrayError(TrayErrorCode.unavailable)
    this.#context.assertOwned()
  }

  /** Resets one transaction's cleanup observation before Graph reconciliation starts. */
  #resetCleanup(): void {
    this.#context.cleanup.errors = []
    this.#context.cleanup.complete = true
    this.#context.cleanup.physical = []
  }

  /** Captures one managed descriptor and its Host-owned admission handles. */
  #createAdmissionRecord(
    plugin: IPluginBinding,
    snapshot: IPluginSnapshot,
    admission: IPluginAdmission<IPluginConstraint<any>>,
    slot?: IPluginDataOrderSlot
  ): IAdmissionRecord {
    /** Retain the exact canonical admission or generation selected by this operation. */
    const record = {
      plugin,
      snapshot,
      admission,
      slot: slot ?? this.#composition!.createDataOrderSlot(snapshot.name),
      artifactCustody: claimArtifactCustody(plugin as object)
    }
    return record
  }
  /** Dispose graph and concrete resources while retaining primary cleanup ordering. */
  #disposeOnce = async (): Promise<ITrayHostDisposalResult> => {
    /** Immediate cleanup errors retain their original order independently of late work. */
    const cleanupErrors: unknown[] = []
    /** Physical cleanup receipts remain observable after a bounded logical result. */
    const physical: Promise<ITrayPluginPhysicalCleanupResult>[] = []
    try {
      this.#resetCleanup()
      /** The published revision detects escaped concrete Host changes before disposal. */
      const externallyMutated = this.#composition!.revision !== this.#context.readExpectedRevision()
      if (externallyMutated) {
        await this.#context.graph.dispose()
        cleanupErrors.push(...this.#context.cleanup.errors)
        physical.push(...this.#context.cleanup.physical)
        if (await this.#deferConcreteDisposal(physical)) {
          this.#state = TrayHostState.terminal
          claims.delete(this.#context.concrete as object)
          this.#hub.publish(ManagedHostEvent.disposed, {
            state: TrayHostState.terminal,
            cleanupComplete: false
          })
          return {
            state: TrayHostState.terminal,
            termination: ManagedHostTermination.externalHost,
            cleanupComplete: false,
            cleanupErrors: Object.freeze(cleanupErrors),
            physicalCompletion: mergeCleanupResults(physical)
          }
        }
        /** Concrete Host disposal retains its own cleanup result and physical continuation. */
        const externalResult = (await this.#context.concrete.dispose()) as IPluginHostDisposalResult
        cleanupErrors.push(...externalResult.cleanupErrors)
        if (externalResult.physicalCompletion)
          physical.push(mergeCleanupResults([externalResult.physicalCompletion]))
        this.#state = TrayHostState.terminal
        claims.delete(this.#context.concrete as object)
        /** Physical receipts or incomplete canonical cleanup keep the public result incomplete. */
        const cleanupComplete =
          this.#context.cleanup.complete && externalResult.cleanupComplete && physical.length === 0
        this.#hub.publish(ManagedHostEvent.disposed, {
          state: TrayHostState.terminal,
          cleanupComplete
        })
        return {
          state: TrayHostState.terminal,
          termination: ManagedHostTermination.externalHost,
          cleanupComplete,
          cleanupErrors: Object.freeze(cleanupErrors),
          ...(physical.length > 0 ? { physicalCompletion: mergeCleanupResults(physical) } : {})
        }
      }
      await this.#context.graph.dispose()
      cleanupErrors.push(...this.#context.cleanup.errors)
      physical.push(...this.#context.cleanup.physical)
      /** Remove only the private anchor acquired by this managed creation session. */
      const anchorRemoval = await this.#context.concrete.unUse(this.#context.anchorName)
      if ('ok' in anchorRemoval && !anchorRemoval.ok) cleanupErrors.push(...anchorRemoval.errors)
      if (await this.#deferConcreteDisposal(physical)) {
        this.#state = TrayHostState.terminal
        claims.delete(this.#context.concrete as object)
        this.#hub.publish(ManagedHostEvent.disposed, {
          state: TrayHostState.terminal,
          cleanupComplete: false
        })
        return {
          state: TrayHostState.terminal,
          termination: ManagedHostTermination.managed,
          cleanupComplete: false,
          cleanupErrors: Object.freeze(cleanupErrors),
          physicalCompletion: mergeCleanupResults(physical)
        }
      }
      /** The canonical owner settles this operation before its observation is published. */
      const result = (await this.#context.concrete.dispose()) as IPluginHostDisposalResult
      cleanupErrors.push(...result.cleanupErrors)
      if (result.physicalCompletion) physical.push(mergeCleanupResults([result.physicalCompletion]))
      /** Physical receipts or incomplete canonical cleanup keep the public result incomplete. */
      const cleanupComplete =
        this.#context.cleanup.complete && result.cleanupComplete && physical.length === 0
      this.#state = TrayHostState.terminal
      claims.delete(this.#context.concrete as object)
      this.#hub.publish(ManagedHostEvent.disposed, {
        state: TrayHostState.terminal,
        cleanupComplete
      })
      return {
        state: TrayHostState.terminal,
        termination: ManagedHostTermination.managed,
        cleanupComplete,
        cleanupErrors: Object.freeze(cleanupErrors),
        ...(physical.length > 0 ? { physicalCompletion: mergeCleanupResults(physical) } : {})
      }
    } catch (error) {
      this.#state = TrayHostState.failed
      this.#terminalError = error
      this.#hub.publish(ManagedHostEvent.disposed, {
        state: TrayHostState.terminal,
        cleanupComplete: false
      })
      return {
        state: TrayHostState.terminal,
        termination: ManagedHostTermination.managed,
        cleanupComplete: false,
        cleanupErrors: Object.freeze([error]),
        error: error instanceof Error ? error : undefined
      }
    }
  }
  /** Defers concrete Host disposal so active Runtime callbacks retain physical custody. */
  #deferConcreteDisposal = async (
    physical: Promise<ITrayPluginPhysicalCleanupResult>[]
  ): Promise<boolean> => {
    if (this.#context.activeRuntimeNames.size === 0) return false
    /** The original Runtime fence retains every still-active callback generation. */
    const runtimeFence = this.#context.waitForRuntimeQuiescence()
    /** Logical deadline observation never cancels or replaces the physical cleanup Promise. */
    const bounded = await new LogicalCleanupWait(runtimeFence, this.#context.options.quiescenceMs)
      .promise
    if (bounded.complete) return false
    this.#context.cleanup.complete = false
    /** Concrete Host disposal begins only after the original Runtime quiescence fence settles. */
    const delayed = runtimeFence.then(
      () => this.#context.concrete!.dispose() as Promise<IPluginHostDisposalResult>
    )
    physical.push(mergeCleanupResults([delayed]))
    return true
  }
}
