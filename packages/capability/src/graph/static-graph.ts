import { unavailableRequiredProvider } from './provider-availability.ts'
/**
 * Static graph registry, level startup and terminal transaction; node resources belong to
 * GraphNodeStart.
 */
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  createGenerationController,
  createLifecycleScope,
  LifecycleErrorPolicy,
  type IGenerationController,
  type ILifecycleScope
} from '@migaia/lifecycle'
import type {
  ICapabilityGraph,
  ICapabilityGraphOptions,
  IGraphNodeDefinition,
  IGraphNodeDiagnostic,
  IGraphNodeId
} from './index.ts'
import { CapabilityGraphErrorCode } from './error-code.ts'
import { invokeCapabilityReporter } from '../reporter.ts'
import { graphFailure } from './errors.ts'
import {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  type ICapabilityGraphState
} from './state-constants.ts'
import { buildCapabilityTopology, TopologyInvalidReason } from './topology.ts'
import { staticGraphFailure, readStaticNode, type IAdmittedNode } from './static-node.ts'
import { GraphNodeStart, type IStaticStartOwner } from './node-start.ts'

/** Owns one fixed registry and its canonical readiness/disposal promises. */
export class StaticCapabilityGraph implements ICapabilityGraph {
  /** Frozen-registry lookup used by admission, startup, and direct-edge reads. */
  #nodesById = new Map<string, IAdmittedNode>()
  /** Registration-ordinal sequence; topology derives schedule from this order. */
  #nodeOrder: IAdmittedNode[] = []
  /** Graph transaction state; node state remains a separate diagnostic axis. */
  #graphState: ICapabilityGraphState = CapabilityGraphState.open
  /** Primary graph error retained across terminal and failed transitions. */
  #graphError: unknown
  /** Canonical readiness promise shared by every caller. */
  #readyPromise: Promise<void> | undefined
  /** Canonical disposal promise shared by every caller. */
  #disposePromise: Promise<void> | undefined
  /** Guards synchronous callbacks without blocking external concurrent operations. */
  #activeCallback = false
  /** Whether readiness already selected its canonical settlement. */
  #readinessSettled = false
  /** Cold-terminal rejected readiness keeps the same reason. */
  #readyReason: unknown
  /** Resolver belongs to the published canonical readiness promise. */
  #resolveReady!: () => void
  /** Rejector belongs to the published canonical readiness promise. */
  #rejectReady!: (error: unknown) => void
  /** Lifecycle owns release order, rollback and all resource cleanup. */
  #root: ILifecycleScope
  /** Lifecycle owns cancellation and stale-start admission. */
  #generations: IGenerationController
  /** Snapshotted diagnostic sink cannot alter graph results. */
  #onError: ICapabilityGraphOptions['onError']

  /** Creates lifecycle owners only after the public factory validated its options. */
  constructor(onError: ICapabilityGraphOptions['onError']) {
    this.#onError = onError
    this.#root = createLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.throw,
      report: this.#reportError
    })
    this.#generations = createGenerationController({ onSuperseded: this.#reportError })
  }

  /** Routes secondary failures through the canonical reporter observer. */
  #reportError = (error: unknown): void => {
    /** Captured callable preserves the original plain-function invocation receiver. */
    const onError = this.#onError
    if (onError) invokeCapabilityReporter(() => onError(error))
  }

  /** Synchronous lifecycle callbacks reject reentry before any graph operation runs. */
  #invokeCallback = <T, A>(callback: (argument: A) => T, argument: A): T => {
    this.#activeCallback = true
    try {
      return callback(argument)
    } finally {
      this.#activeCallback = false
    }
  }

  /** Resolve one actual registered node for the two public read-only projections. */
  #findNode = (id: IGraphNodeId): IAdmittedNode => {
    /** Unknown identifiers use the existing query error without acquiring any resource. */
    const node = this.#nodesById.get(id)
    if (!node) throw staticGraphFailure(CapabilityGraphErrorCode.unknownNode, { id })
    return node
  }

  /** Visibility is shared by diagnostics and direct reads, with no mirrored value/lifecycle state. */
  #visibleValue = (node: IAdmittedNode): unknown =>
    this.#graphState === CapabilityGraphState.ready && node.state === CapabilityGraphNodeState.ready
      ? node.value
      : undefined

  /** Rejects registration once readiness or terminal cleanup has closed admission. */
  #assertMutationOpen = (): void => {
    if (this.#graphState === CapabilityGraphState.terminal)
      throw staticGraphFailure(CapabilityGraphErrorCode.graphDisposed)
    if (this.#graphState === CapabilityGraphState.quiescing)
      throw staticGraphFailure(CapabilityGraphErrorCode.admissionClosed)
    if (this.#graphState !== CapabilityGraphState.open)
      throw staticGraphFailure(CapabilityGraphErrorCode.graphFrozen)
  }

  /** Derives ephemeral startup layers from the canonical topology's level and ordinal facts. */
  #assertKnownAndAcyclic = (): readonly (readonly IAdmittedNode[])[] => {
    /** The canonical topology computes levels and stable ordinal order once. */
    const topology = buildCapabilityTopology(
      this.#nodeOrder,
      (nodeId, provider) => {
        throw staticGraphFailure(CapabilityGraphErrorCode.unknownProvider, { nodeId, provider })
      },
      (path) => {
        throw staticGraphFailure(CapabilityGraphErrorCode.dependencyCycle, { path })
      },
      (reason, nodeId) => {
        /** Admission reasons retain the existing graph error-code mapping. */
        const code =
          reason === TopologyInvalidReason.duplicateNode
            ? CapabilityGraphErrorCode.duplicateNode
            : CapabilityGraphErrorCode.invalidNode
        throw staticGraphFailure(code, nodeId === undefined ? undefined : { nodeId })
      }
    )
    /** The registry already indexes admitted nodes, avoiding a second lookup table. */
    const admittedById = this.#nodesById
    /** Only this startup snapshot owns buckets; topology remains the edge and level authority. */
    const layers: IAdmittedNode[][] = []
    for (const node of topology.ordered) {
      /** The canonical longest-path level selects the startup barrier. */
      const level = topology.level.get(node.id)!
      ;(layers[level] ??= []).push(admittedById.get(node.id)!)
    }
    return layers
  }

  /** Starts each level together, then settles its failures before rollback or the next level. */
  #startGraph = async (): Promise<void> => {
    this.#graphState = CapabilityGraphState.starting
    try {
      /** One immutable topology snapshot supplies every level startup barrier. */
      const layers = this.#assertKnownAndAcyclic()
      /** Lifecycle owns the shared graph generation and cancellation signal. */
      const request = this.#generations.begin()
      /** Shared startup context delegates resources to lifecycle and keeps graph state canonical. */
      const owner: IStaticStartOwner = {
        root: this.#root,
        generations: this.#generations,
        token: request.token,
        signal: request.signal,
        isStarting: () => this.#graphState === CapabilityGraphState.starting,
        invokeCallback: this.#invokeCallback,
        report: this.#reportError,
        provider: (id) => this.#nodesById.get(id)
      }
      /** Physical release order follows the full topology, independent of async completion. */
      let releaseOrder = 0
      for (const layer of layers) {
        if (this.#graphState !== CapabilityGraphState.starting)
          throw staticGraphFailure(CapabilityGraphErrorCode.admissionClosed)
        for (const node of layer) {
          /** Shared graph availability owns the first unavailable required provider scan. */
          const blocked =
            unavailableRequiredProvider(node.dependencies, this.#nodesById) !== undefined
          if (blocked) {
            node.state = CapabilityGraphNodeState.blocked
            throw staticGraphFailure(CapabilityGraphErrorCode.providerUnavailable, {
              nodeId: node.id
            })
          }
        }
        /** AllSettled keeps each in-flight start observed and includes successful peers in rollback. */
        const results = await Promise.allSettled(
          layer.map((node) => new GraphNodeStart(node, ++releaseOrder, owner).run())
        )
        /** Rejections retain ordinal order even when later nodes reject first. */
        const failures: unknown[] = []
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
        if (failures.length > 0)
          throw graphFailure(
            CapabilityGraphErrorCode.startFailed,
            attachSecondaryErrors(failures[0], failures.slice(1))
          )
      }
      if (this.#graphState !== CapabilityGraphState.starting)
        throw staticGraphFailure(CapabilityGraphErrorCode.admissionClosed)
      this.#graphState = CapabilityGraphState.ready
      this.#resolveReady()
    } catch (error) {
      /** Retain the state observed before asynchronous rollback begins. */
      const currentState = this.#graphState as ICapabilityGraphState
      /** Terminal phases cannot be replaced by a late startup continuation. */
      const terminal =
        currentState === CapabilityGraphState.quiescing ||
        currentState === CapabilityGraphState.terminal
      if (!terminal) {
        this.#graphError = error
      } else if (this.#graphError === undefined) {
        this.#graphError = error
      }
      try {
        await this.#root.dispose()
      } catch (cleanupError) {
        this.#reportError(cleanupError)
      }
      if (!terminal) this.#graphState = CapabilityGraphState.failed
      for (const node of this.#nodeOrder) {
        if (node.state === CapabilityGraphNodeState.registered) {
          node.state = CapabilityGraphNodeState.blocked
        } else if (
          node.state === CapabilityGraphNodeState.ready ||
          node.state === CapabilityGraphNodeState.released
        ) {
          node.state = CapabilityGraphNodeState.rolledBack
        }
      }
      if (!this.#readinessSettled) this.#rejectReady(error)
    } finally {
      this.#readinessSettled = true
    }
  }

  /** Publishes canonical readiness before starting, retaining detached-call behavior. */
  ready = (): Promise<void> => {
    if (this.#activeCallback) throw staticGraphFailure(CapabilityGraphErrorCode.reentrantOperation)
    if (this.#readyPromise) return this.#readyPromise
    if (
      this.#graphState === CapabilityGraphState.terminal ||
      this.#graphState === CapabilityGraphState.quiescing
    ) {
      /** Cold-terminal callers reuse the first selected readiness failure. */
      const reason =
        this.#readyReason ??
        this.#graphError ??
        staticGraphFailure(
          this.#graphState === CapabilityGraphState.terminal
            ? CapabilityGraphErrorCode.graphDisposed
            : CapabilityGraphErrorCode.admissionClosed
        )
      this.#readyReason = reason
      this.#readyPromise = Promise.reject(reason)
      void this.#readyPromise.catch(() => undefined)
      return this.#readyPromise
    }
    if (this.#graphState === CapabilityGraphState.failed) return Promise.reject(this.#graphError)
    this.#readyPromise = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    void this.#startGraph()
    return this.#readyPromise
  }

  /** Revokes values immediately, then preserves canonical terminal cleanup identity. */
  dispose = (): Promise<void> => {
    if (this.#activeCallback) throw staticGraphFailure(CapabilityGraphErrorCode.reentrantOperation)
    if (this.#disposePromise) return this.#disposePromise
    if (this.#graphState === CapabilityGraphState.terminal) return Promise.resolve()
    this.#graphState = CapabilityGraphState.quiescing
    for (const node of this.#nodeOrder) node.value = undefined
    /** Generation cleanup failure is reported and retained by terminal disposal. */
    let generationError: unknown
    try {
      this.#generations.dispose(staticGraphFailure(CapabilityGraphErrorCode.graphDisposed))
    } catch (error) {
      generationError = error
      this.#reportError(error)
    }
    if (!this.#readinessSettled && this.#readyPromise) {
      this.#graphError = staticGraphFailure(CapabilityGraphErrorCode.admissionClosed)
      this.#rejectReady(this.#graphError)
      this.#readinessSettled = true
    }
    /** The first root cleanup Promise becomes the graph disposal identity. */
    const currentDisposePromise = this.#root.dispose().then(
      () => {
        this.#graphState = CapabilityGraphState.terminal
        if (generationError !== undefined) {
          this.#graphError = graphFailure(CapabilityGraphErrorCode.disposeFailed, generationError)
          this.#readyReason ??= this.#graphError
          throw this.#graphError
        }
      },
      (error: unknown) => {
        this.#graphState = CapabilityGraphState.terminal
        this.#graphError = graphFailure(CapabilityGraphErrorCode.disposeFailed, error)
        this.#readyReason ??= this.#graphError
        throw this.#graphError
      }
    )
    this.#disposePromise = currentDisposePromise
    return currentDisposePromise
  }

  /** Captures one definition only while the graph registry is open. */
  register = <T>(node: IGraphNodeDefinition<T>): void => {
    this.#assertMutationOpen()
    /** Admission owns immutable fields and direct-provider membership. */
    const admitted = readStaticNode(node, this.#nodeOrder.length)
    if (this.#nodesById.has(admitted.id))
      throw staticGraphFailure(CapabilityGraphErrorCode.duplicateNode, { id: admitted.id })
    this.#nodesById.set(admitted.id, admitted)
    this.#nodeOrder.push(admitted)
  }

  /** Returns a frozen value projection without transferring ownership. */
  nodeState = (id: IGraphNodeId): IGraphNodeDiagnostic => {
    /** Canonical registry entry also serves direct reads. */
    const node = this.#findNode(id)
    return Object.freeze({
      id: node.id,
      kind: node.kind,
      state: node.state,
      value: this.#visibleValue(node),
      error: node.error
    })
  }

  /** Reads published data without allocating a diagnostic record. */
  readValue = <T>(id: IGraphNodeId): T | undefined =>
    this.#visibleValue(this.#findNode(id)) as T | undefined

  /** Reads only declared ready providers after graph admission guards. */
  get = <T>(consumer: IGraphNodeId, provider: IGraphNodeId): T => {
    /** Membership was indexed at definition admission, avoiding per-query edge scans. */
    const consumerNode = this.#nodesById.get(consumer)
    if (
      this.#graphState === CapabilityGraphState.starting ||
      this.#graphState === CapabilityGraphState.quiescing
    )
      throw staticGraphFailure(CapabilityGraphErrorCode.admissionClosed)
    if (this.#graphState === CapabilityGraphState.terminal)
      throw staticGraphFailure(CapabilityGraphErrorCode.graphDisposed)
    if (!consumerNode || !consumerNode.declared.has(provider))
      throw staticGraphFailure(CapabilityGraphErrorCode.providerUnavailable, { consumer, provider })
    /** Provider identity is resolved once after consumer admission. */
    const providerNode = this.#nodesById.get(provider)
    if (!providerNode || providerNode.state !== CapabilityGraphNodeState.ready)
      throw staticGraphFailure(CapabilityGraphErrorCode.providerUnavailable, { consumer, provider })
    return providerNode.value as T
  }

  /** Registration-order diagnostics survive terminal cleanup. */
  get nodes(): readonly IGraphNodeId[] {
    return Object.freeze(this.#nodeOrder.map((node) => node.id))
  }
  /** Exposes the transaction phase without mirroring node availability. */
  get state(): ICapabilityGraphState {
    return this.#graphState
  }
  /** Exposes the retained primary graph failure. */
  get error(): unknown {
    return this.#graphError
  }
}
