import type { ITraceSink } from './trace/sink.ts'
import type { IPartFacets, IPartNode } from '@migaia/part-contract'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { IEnhancerDefinition } from './types.ts'

/** Visit marks of the ordering walk: on the stack, or already emitted. */
const VisitMark = { active: 'active', done: 'done' } as const

/** One visit mark. */
type VisitMark = keyof typeof VisitMark

/** Ordering state shared by one `orderEnhancers` call. */
type IOrderState = {
  readonly byId: ReadonlyMap<string, IEnhancerDefinition<unknown>>
  readonly marks: Map<string, VisitMark>
  readonly ordered: IEnhancerDefinition<unknown>[]
  readonly tag: string
}

/** Emits one enhancer after its `after` predecessors; each enhancer is finished once. */
function visit(state: IOrderState, enhancer: IEnhancerDefinition<unknown>): void {
  /** Id of the enhancer. */
  const id = enhancer.descriptor.id
  /** Current mark. */
  const mark = state.marks.get(id)
  if (mark === VisitMark.done) return
  if (mark === VisitMark.active)
    throw createPartHostError(
      PartHostErrorCode.enhancerCycle,
      PartHostErrorText.enhancerCycle(state.tag)
    )
  state.marks.set(id, VisitMark.active)
  for (const predecessor of enhancer.descriptor.after ?? []) {
    /** Predecessor on the same tag; predecessors on other tags impose no order here. */
    const target = state.byId.get(predecessor)
    if (target !== undefined) visit(state, target)
  }
  state.marks.set(id, VisitMark.done)
  state.ordered.push(enhancer)
}

/**
 * Orders the enhancers of one tag: registration order, with every `after` predecessor emitted
 * first. Runs in O(enhancers + after edges); a cycle throws ENHANCER_CYCLE.
 */
export function orderEnhancers(
  tag: string,
  enhancers: readonly IEnhancerDefinition<unknown>[]
): readonly IEnhancerDefinition<unknown>[] {
  /** Walk state. */
  const state: IOrderState = {
    byId: new Map(enhancers.map((enhancer) => [enhancer.descriptor.id, enhancer])),
    marks: new Map(),
    ordered: [],
    tag
  }
  for (const enhancer of enhancers) visit(state, enhancer)
  return state.ordered
}

/** Freezes a configuration so an enhancer cannot change the object it received. */
function freeze(config: IPartFacets): IPartFacets {
  Object.freeze(config)
  for (const group of Object.values(config))
    if (typeof group === 'object' && group !== null) Object.freeze(group)
  return config
}

/**
 * Runs ordered enhancers over a node's configuration. Each enhancer receives a frozen input and
 * returns a new configuration; a TypeError from writing into the input becomes
 * ENHANCER_MUTATED_INPUT.
 */
export function applyEnhancers(
  enhancers: readonly IEnhancerDefinition<unknown>[],
  node: IPartNode,
  address: string,
  trace?: ITraceSink
): IPartFacets {
  /** Configuration flowing through the enhancers. */
  let config: IPartFacets = node.facets ?? {}
  traceStep(trace, address, 'authored', undefined, config, config)
  for (const enhancer of enhancers) {
    try {
      /** Input of this enhancer. */
      const input = config
      config = enhancer.transform(freeze(config), { address, node, args: undefined })
      traceStep(trace, address, 'enhancer', enhancer.descriptor.id, input, config)
    } catch (cause) {
      if (cause instanceof TypeError)
        throw createPartHostError(
          PartHostErrorCode.enhancerMutatedInput,
          PartHostErrorText.enhancerMutatedInput(enhancer.descriptor.id),
          cause
        )
      throw cause
    }
  }
  traceStep(trace, address, 'resolved', undefined, config, config)
  return config
}

/** Records one enhancement step when tracing is enabled. */
function traceStep(
  trace: ITraceSink | undefined,
  address: string,
  stage: 'authored' | 'enhancer' | 'resolved',
  enhancer: string | undefined,
  input: IPartFacets,
  output: IPartFacets
): void {
  if (trace?.enabled !== true) return
  trace.step({
    address,
    stage,
    ...(enhancer === undefined ? {} : { enhancer }),
    input,
    output,
    at: Date.now()
  })
}
