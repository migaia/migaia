import type { IHostPipelineEntry } from '../../pipeline-module-types.ts'
/**
 * Owns one through bridge and its exact edge-removal state; native runner and stage lifetimes are
 * reused.
 */
import { MiddlewarePipelineGeneratorSignals } from '@migaia/middleware-pipeline'

import type { IPipelineStageHandle } from '../../pipeline-spec.ts'

/** Explicit target owner avoids nested generator/callback construction during through admission. */
export class PluginPipelineThrough<TDomainCore extends object, TValue> {
  /** Exact target lane retained only for this registered bridge's lifetime. */
  readonly #target: IHostPipelineEntry<TDomainCore, TValue>

  /** Captures the already-admitted target without executing it. */
  constructor(target: IHostPipelineEntry<TDomainCore, TValue>) {
    this.#target = target
  }

  /** Generator bridges forward one terminal value, preserving halt versus explicit undefined. */
  async *forward(value: TValue) {
    /** Target short-circuit means this bridge also halts. */
    let forwarded = false
    /** The final target terminal invocation owns the forwarded payload. */
    let result: TValue | undefined
    await this.#target.run(value, (next) => {
      forwarded = true
      result = next
    })
    if (!forwarded) return
    return result === undefined ? MiddlewarePipelineGeneratorSignals.undefined : result
  }
}

/** One exact bridge owns its edge count and idempotent stage remover. */
export class PluginPipelineThroughRemoval<TDomainCore extends object, TValue> {
  /** Existing graph owns all through edges; this remover changes only its exact source/target pair. */
  readonly #edges: Map<
    IHostPipelineEntry<TDomainCore, TValue>,
    Map<IHostPipelineEntry<TDomainCore, TValue>, number>
  >
  /** Exact source whose final outgoing edge removes the graph entry. */
  readonly #source: IHostPipelineEntry<TDomainCore, TValue>
  /** Exact target count is decremented once at explicit removal or native cleanup. */
  readonly #target: IHostPipelineEntry<TDomainCore, TValue>
  /** Original source stage handle owns physical stage detachment. */
  readonly #handle: IPipelineStageHandle
  /** Original shared outgoing-edge table remains stable for other removers. */
  readonly #targets: Map<IHostPipelineEntry<TDomainCore, TValue>, number>
  /** Explicit and registration-owned removals share one idempotency bit. */
  #alive = true

  /** Binds the existing admitted occurrence and graph entry without adding another cleanup ledger. */
  constructor(
    edges: Map<
      IHostPipelineEntry<TDomainCore, TValue>,
      Map<IHostPipelineEntry<TDomainCore, TValue>, number>
    >,
    source: IHostPipelineEntry<TDomainCore, TValue>,
    target: IHostPipelineEntry<TDomainCore, TValue>,
    handle: IPipelineStageHandle,
    targets: Map<IHostPipelineEntry<TDomainCore, TValue>, number>
  ) {
    this.#edges = edges
    this.#source = source
    this.#target = target
    this.#handle = handle
    this.#targets = targets
  }

  /** Detached calls and native disposal retain this exact occurrence owner. */
  readonly remove = (): void => this.#remove()

  /** Detaches before decrementing edge state, matching the original failure and idempotency order. */
  #remove(): void {
    if (!this.#alive) return
    this.#alive = false
    this.#handle.remove()
    /** The admitted edge count includes this exact occurrence until its first removal. */
    const remaining = this.#targets.get(this.#target)! - 1
    if (remaining) this.#targets.set(this.#target, remaining)
    else this.#targets.delete(this.#target)
    if (this.#targets.size === 0) this.#edges.delete(this.#source)
  }
}
