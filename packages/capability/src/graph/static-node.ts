/** Captures static node definitions and direct-edge membership; owns no resources or scheduling. */
import type { IGenerationToken } from '@migaia/lifecycle'
import type { IGraphNodeId, IGraphDependency, IGraphNodeDefinition } from './index.ts'
import { CapabilityGraphNodeState, type ICapabilityGraphNodeState } from './state-constants.ts'
import { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.ts'
import {
  createCapabilityGraphError,
  graphFailure,
  graphMessageFor,
  type ICapabilityGraphError
} from './errors.ts'

/** Constructs the canonical static graph boundary error without replacing native failures. */
export function staticGraphFailure(
  code: ICapabilityGraphErrorCode,
  detail?: Readonly<Record<string, unknown>>
): ICapabilityGraphError {
  return createCapabilityGraphError(code, graphMessageFor(code), { detail })
}

/** Static registry facts and diagnostics; lifecycle resources stay with the node startup owner. */
export type IAdmittedNode = {
  readonly id: IGraphNodeId
  readonly kind: string
  readonly dependencies: readonly IGraphDependency[]
  /** Direct-provider membership captured with edges for constant-time reads. */
  readonly declared: ReadonlySet<string>
  readonly start: IGraphNodeDefinition<unknown>['start']
  readonly ordinal: number
  state: ICapabilityGraphNodeState
  value?: unknown
  error?: unknown
  token?: IGenerationToken
}

/** Reads every caller-owned definition field once and builds immutable edge facts. */
export function readStaticNode<T>(input: IGraphNodeDefinition<T>, ordinal: number): IAdmittedNode {
  /** Captured node identity is validated before registration. */
  let id: unknown
  /** Captured application classification is independent of edge routing. */
  let kind: unknown
  /** The original array is read once before immutable edge admission. */
  let dependencies: unknown
  /** The captured callable retains the admitted node method receiver. */
  let start: unknown
  try {
    id = input.id
    kind = input.kind
    dependencies = input.dependencies
    start = input.start
  } catch (error) {
    throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
  }
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    typeof start !== 'function' ||
    !Array.isArray(dependencies)
  )
    throw staticGraphFailure(CapabilityGraphErrorCode.invalidNode)
  /** Immutable edge records preserve caller declaration order. */
  const edges: IGraphDependency[] = []
  /** One membership index rejects duplicate edges and serves direct reads. */
  const seenProviders = new Set<string>()
  /** Read hostile array length once without invoking a custom iterator. */
  let length: number
  try {
    length = dependencies.length
  } catch (error) {
    throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
  }
  if (!Number.isSafeInteger(length) || length < 0)
    throw staticGraphFailure(CapabilityGraphErrorCode.invalidNode)
  for (let index = 0; index < length; index += 1) {
    /** Read the edge slot once before accessing its provider fields. */
    let raw: unknown
    try {
      raw = dependencies[index]
    } catch (error) {
      throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
    }
    /** Provider identity is captured once for lookup and duplicate admission. */
    let provider: unknown
    /** Static graphs admit only explicitly required provider edges. */
    let required: unknown
    try {
      provider = (raw as { provider?: unknown }).provider
      required = (raw as { required?: unknown }).required
    } catch (error) {
      throw graphFailure(CapabilityGraphErrorCode.invalidNode, error)
    }
    if (typeof provider !== 'string' || required !== true)
      throw staticGraphFailure(CapabilityGraphErrorCode.invalidNode)
    if (seenProviders.has(provider))
      throw staticGraphFailure(CapabilityGraphErrorCode.duplicateEdge, { id, provider })
    seenProviders.add(provider)
    edges.push(Object.freeze({ provider: provider as IGraphNodeId, required: true }))
  }
  return {
    id: id as IGraphNodeId,
    kind,
    dependencies: Object.freeze(edges),
    declared: seenProviders,
    start: start as IAdmittedNode['start'],
    ordinal,
    state: CapabilityGraphNodeState.registered
  }
}
