/**
 * Captures dynamic definitions and adapts topology admission failures to graph errors. This module
 * owns no graph state, lifecycle resource, queue, or physical startup.
 */
import {
  admitTopologyId,
  snapshotTopologyDependencies,
  type ITopologySnapshotFailure
} from './topology-admission.js'
import { TopologyInvalidReason } from './topology.js'
import { CapabilityGraphErrorCode, type ICapabilityGraphErrorCode } from './error-code.js'
import { graphFailure, graphMessageFor } from './errors.js'
import type { IDynamicGraphNodeDefinition } from './dynamic.js'
import type { IGraphNodeId } from './index.js'

/** Constructs the existing graph error without changing its message or native-error identity. */
export function dynamicFailure(code: ICapabilityGraphErrorCode) {
  return graphFailure(code, graphMessageFor(code))
}

/** Preserves structural getter failures and the separate duplicate-edge admission code. */
const invalidDynamicNode: ITopologySnapshotFailure = (reason, _nodeId, failure) => {
  /** Duplicate provider identities retain their existing admission diagnostic. */
  const code =
    reason === TopologyInvalidReason.duplicateEdge
      ? CapabilityGraphErrorCode.duplicateEdge
      : CapabilityGraphErrorCode.invalidNode
  if (failure) throw graphFailure(code, failure.cause)
  throw dynamicFailure(code)
}

/** Snapshots caller facts once at queue admission, before topology or lifecycle effects. */
export function snapshotDynamicNode(
  input: IDynamicGraphNodeDefinition<unknown>
): IDynamicGraphNodeDefinition<unknown> {
  if (!input || typeof input !== 'object')
    throw dynamicFailure(CapabilityGraphErrorCode.invalidNode)
  /** Stable identity captured before inspecting mutable caller-owned dependencies. */
  let idValue: unknown
  /** Application classification remains independent of provider routing. */
  let kind: unknown
  /** Original callable and receiver remain paired after admission. */
  let start: unknown
  /** Raw edges pass through the shared pure topology admission owner. */
  let dependenciesValue: unknown
  try {
    idValue = input.id
    kind = input.kind
    start = input.start
    dependenciesValue = input.dependencies
  } catch (cause) {
    throw graphFailure(CapabilityGraphErrorCode.invalidNode, cause)
  }
  /** Registered identity reused by the immutable definition and the topology index. */
  const id = admitTopologyId(idValue, invalidDynamicNode)
  if (typeof kind !== 'string' || kind.length === 0 || typeof start !== 'function')
    throw dynamicFailure(CapabilityGraphErrorCode.invalidNode)
  /** Frozen declarations prevent caller mutations from rewriting graph facts. */
  const dependencies = snapshotTopologyDependencies(dependenciesValue, id, invalidDynamicNode)
  for (const edge of dependencies)
    if (edge.provider === id) throw dynamicFailure(CapabilityGraphErrorCode.duplicateEdge)
  return Object.freeze({
    id: id as IGraphNodeId,
    kind,
    dependencies: dependencies as IDynamicGraphNodeDefinition<unknown>['dependencies'],
    // Captured invocation retains method-style starts without rereading input.start.
    start: (context) => Reflect.apply(start, input, [context])
  })
}
