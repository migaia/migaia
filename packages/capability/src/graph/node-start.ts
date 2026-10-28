/**
 * Owns one static node startup and primary release; lifecycle owns provisional rollback and
 * cancellation.
 */
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import {
  createProvisionalScope,
  type IGenerationController,
  type IGenerationToken,
  type ILifecycleScope,
  type IProvisionalScope,
  type IReleaseContext,
  type IReleaseDescriptor
} from '@migaia/lifecycle'
import type { IGraphNodeId, IGraphNodeInstance, IGraphStartContext } from './index.ts'
import { CapabilityGraphNodeState } from './state-constants.ts'
import { CapabilityGraphErrorCode } from './error-code.ts'
import { graphFailure } from './errors.ts'
import { staticGraphFailure, type IAdmittedNode } from './static-node.ts'
import { orderedAuxiliaryDescriptor } from './node-start-descriptor.ts'

/** Explicit graph transaction capabilities used by one node, without a reverse runtime dependency. */
export type IStaticStartOwner = {
  /** Lifecycle owns all successfully committed primary and auxiliary resources. */
  readonly root: ILifecycleScope
  /** Lifecycle decides whether this transaction can still publish values. */
  readonly generations: IGenerationController
  /** Every static start shares the graph token without superseding peer nodes. */
  readonly token: IGenerationToken
  /** The graph transaction signal stays live until graph disposal. */
  readonly signal: INativeAbortSignal
  /** Reads canonical graph admission at the moment a context is used. */
  readonly isStarting: () => boolean
  /** Guards same-stack reentry while invoking user lifecycle callbacks. */
  readonly invokeCallback: <T, A>(callback: (argument: A) => T, argument: A) => T
  /** Reports secondary failures without replacing startup's primary error. */
  readonly report: (error: unknown) => void
  /** Resolves provider identity from the graph's canonical registry. */
  readonly provider: (id: IGraphNodeId) => IAdmittedNode | undefined
}

/** Owns setup context lifetime, primary admission, and release diagnostics for one node. */
export class GraphNodeStart {
  /** Admitted definition and its diagnostic state remain owned by the graph registry. */
  #node: IAdmittedNode
  /** Canonical transaction capabilities avoid closing over graph implementation state. */
  #owner: IStaticStartOwner
  /** Fixed canonical release rank does not depend on asynchronous completion order. */
  #releaseOrder: number
  /** Lifecycle provisional scope handles rollback and transfer exactly once. */
  #provisional!: IProvisionalScope
  /** Setup capability is revoked as soon as this node settles. */
  #contextActive = true
  /** Identity membership rejects auxiliary/primary double ownership in constant time. */
  #auxiliaryResources = new Set<unknown>()

  /** Allocates one provisional owner before invoking application startup. */
  constructor(node: IAdmittedNode, releaseOrder: number, owner: IStaticStartOwner) {
    this.#node = node
    this.#releaseOrder = releaseOrder
    this.#owner = owner
  }

  /** Setup reads/ownership expire on settlement, supersession or graph quiescence. */
  #assertContextActive(): void {
    if (!this.#contextActive || !this.#isCurrent())
      throw staticGraphFailure(CapabilityGraphErrorCode.admissionClosed, { nodeId: this.#node.id })
  }

  /** Reads canonical generation and graph state together at every commit boundary. */
  #isCurrent(): boolean {
    return this.#owner.generations.isCurrent(this.#owner.token) && this.#owner.isStarting()
  }

  /** Reads a declared ready direct provider without scanning the dependency list. */
  #getProvider = <T>(provider: IGraphNodeId): T => {
    this.#assertContextActive()
    if (!this.#node.declared.has(provider))
      throw staticGraphFailure(CapabilityGraphErrorCode.providerUnavailable, {
        nodeId: this.#node.id,
        provider
      })
    /** Lookup follows direct-edge admission and keeps original provider value identity. */
    const providerNode = this.#owner.provider(provider)
    if (!providerNode || providerNode.state !== CapabilityGraphNodeState.ready)
      throw staticGraphFailure(CapabilityGraphErrorCode.providerUnavailable, {
        nodeId: this.#node.id,
        provider
      })
    return providerNode.value as T
  }

  /** Admits one auxiliary through lifecycle while retaining Graph-owned boundary errors. */
  #own = <T>(resource: T, descriptor: IReleaseDescriptor): T => {
    this.#assertContextActive()
    try {
      /** Descriptor access remains lazy and guarded at the original lifecycle boundary. */
      const orderedDescriptor = orderedAuxiliaryDescriptor(
        descriptor,
        this.#releaseOrder,
        this.#owner.invokeCallback
      )
      /** The provisional scope owns cleanup; this set only detects duplicate primary ownership. */
      const owned = this.#provisional.own(resource, orderedDescriptor)
      // Strict equality never matched NaN in the original auxiliary identity scan.
      if (!Number.isNaN(resource)) this.#auxiliaryResources.add(resource)
      return owned
    } catch (error) {
      throw graphFailure(CapabilityGraphErrorCode.invalidOption, error, { nodeId: this.#node.id })
    }
  }

  /** Captures the bounded startup capability without exposing the node owner. */
  #context(): IGraphStartContext {
    return {
      nodeId: this.#node.id,
      signal: this.#owner.signal,
      get: this.#getProvider,
      own: this.#own
    }
  }

  /** Reads result fields once in release-then-value order before primary ownership transfers. */
  #admitResult(result: IGraphNodeInstance<unknown>): {
    release: IGraphNodeInstance<unknown>['release']
    value: unknown
  } {
    /** Captured callable is invoked as a plain function, matching the original receiver semantics. */
    let release: unknown
    /** Application payload retains identity and remains mutable. */
    let value: unknown
    try {
      release = result.release
      value = result.value
    } catch (admissionError) {
      throw graphFailure(CapabilityGraphErrorCode.invalidNode, admissionError, {
        nodeId: this.#node.id
      })
    }
    if (result === null || typeof result !== 'object' || typeof release !== 'function')
      throw staticGraphFailure(CapabilityGraphErrorCode.invalidNode, { nodeId: this.#node.id })
    if (this.#auxiliaryResources.has(value))
      throw staticGraphFailure(CapabilityGraphErrorCode.invalidNode, { nodeId: this.#node.id })
    return { release: release as IGraphNodeInstance<unknown>['release'], value }
  }

  /** Releases an admitted late primary after rollback, observing hostile thenables and failures. */
  #releaseLate(release: IGraphNodeInstance<unknown>['release']): void {
    try {
      /** Late primary cleanup remains detached so disposal never waits for non-cooperative start. */
      const result = release({
        nodeId: this.#node.id,
        signal: this.#owner.signal,
        report: this.#owner.report
      })
      /** Captures then once so diagnostic cleanup cannot leak a rejection. */
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch(this.#owner.report)
      else if (probe.kind === ThenableProbeKind.failed) this.#owner.report(probe.error)
    } catch (error) {
      this.#owner.report(error)
    }
  }

  /** Stores primary cleanup failure before lifecycle aggregates it at graph disposal. */
  #releaseFailed(error: unknown): never {
    this.#node.error = error
    this.#node.state = CapabilityGraphNodeState.failed
    throw error
  }

  /** Runs a primary release with reentry guards and traceable node diagnostics. */
  #releasePrimary(
    release: IGraphNodeInstance<unknown>['release'],
    context: IReleaseContext
  ): void | PromiseLike<void> {
    /** User cleanup may be synchronous, asynchronous, or an arbitrary foreign thenable. */
    let result: void | PromiseLike<void>
    try {
      result = this.#owner.invokeCallback(release, {
        nodeId: this.#node.id,
        signal: context.signal,
        report: this.#owner.report
      })
    } catch (error) {
      return this.#releaseFailed(error)
    }
    /** Probe once before assimilation to preserve getter and failure identity. */
    const probe = probeThenable(result)
    if (probe.kind === ThenableProbeKind.failed) return this.#releaseFailed(probe.error)
    if (probe.kind === ThenableProbeKind.thenable) {
      return assimilateCapturedThen(probe.thenFn, result).then(
        () => {
          this.#node.state = CapabilityGraphNodeState.released
        },
        (error: unknown) => this.#releaseFailed(error)
      )
    }
    this.#node.state = CapabilityGraphNodeState.released
    return result
  }

  /** Starts once, transfers successful ownership, or rolls back without replacing primary failure. */
  async run(): Promise<void> {
    this.#node.state = CapabilityGraphNodeState.starting
    this.#node.token = this.#owner.token
    this.#provisional = createProvisionalScope({ parentSignal: this.#owner.signal })
    try {
      /** The admitted definition keeps its original method-call receiver. */
      const started = this.#owner.invokeCallback(
        (context) => this.#node.start(context),
        this.#context()
      )
      /** Captures a hostile then getter once, before awaiting a foreign result. */
      const probe = probeThenable(started)
      /** Admitted resource is retained until root ownership or late cleanup takes responsibility. */
      let result: IGraphNodeInstance<unknown>
      if (probe.kind === ThenableProbeKind.thenable)
        result = await assimilateCapturedThen<IGraphNodeInstance<unknown>>(probe.thenFn, started)
      else if (probe.kind === ThenableProbeKind.failed) throw probe.error
      else result = started as IGraphNodeInstance<unknown>
      const { release, value } = this.#admitResult(result)
      if (!this.#isCurrent()) {
        try {
          await this.#provisional.rollback()
        } finally {
          this.#releaseLate(release)
        }
        this.#node.state = CapabilityGraphNodeState.rolledBack
        return
      }
      await this.#provisional.commitTo(this.#owner.root)
      this.#owner.root.own(result, {
        order: this.#releaseOrder,
        force: (context: IReleaseContext) => this.#releasePrimary(release, context)
      })
      this.#node.value = value
      this.#node.state = CapabilityGraphNodeState.ready
    } catch (error) {
      try {
        await this.#provisional.rollback()
      } catch (cleanupError) {
        this.#owner.report(cleanupError)
      }
      if (!this.#isCurrent()) {
        this.#node.state = CapabilityGraphNodeState.rolledBack
        this.#owner.report(error)
        return
      }
      this.#node.error = graphFailure(CapabilityGraphErrorCode.startFailed, error, {
        nodeId: this.#node.id
      })
      this.#node.state = CapabilityGraphNodeState.failed
      throw this.#node.error
    } finally {
      this.#contextActive = false
      this.#auxiliaryResources.clear()
    }
  }
}
