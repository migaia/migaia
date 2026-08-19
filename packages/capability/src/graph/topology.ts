import type { IGraphDependency, IGraphNodeId } from './index.js';

/** Minimal admitted node shape consumed by the static and future dynamic topology owners. */
export type ITopologyNode = {
  readonly id: IGraphNodeId;
  readonly dependencies: readonly IGraphDependency[];
  readonly ordinal: number;
};

/** Frozen topology snapshot shared by static Graph and future dynamic graph oracles. */
export type ICapabilityTopology = {
  readonly ordered: readonly ITopologyNode[];
  /** Provider-to-consumer facts retained for dynamic graph reuse. */
  readonly providers: ReadonlyMap<string, readonly ITopologyNode[]>;
  /** Consumer-to-provider facts retained as the canonical edge snapshot. */
  readonly consumers: ReadonlyMap<string, readonly IGraphDependency[]>;
  /** Remaining dependency count at topology admission. */
  readonly indegree: ReadonlyMap<string, number>;
  readonly level: ReadonlyMap<string, number>;
  /** Registration ordinal for stable same-level scheduling. */
  readonly ordinal: ReadonlyMap<string, number>;
};

/** Finds one stable closed cycle path inside Kahn's residual graph. */
function findStableCyclePath(
  nodes: readonly ITopologyNode[],
  residualIndegree: ReadonlyMap<string, number>
): readonly string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const residual = new Set(
    nodes.filter((node) => (residualIndegree.get(node.id) ?? 0) > 0).map((node) => node.id)
  );
  const colors = new Map<string, 'gray' | 'black'>();
  for (const root of nodes) {
    if (!residual.has(root.id) || colors.has(root.id)) continue;
    const path: string[] = [root.id];
    const frames: Array<{ readonly node: ITopologyNode; index: number }> = [
      { node: root, index: 0 }
    ];
    colors.set(root.id, 'gray');
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const dependency = frame.node.dependencies[frame.index];
      frame.index += 1;
      if (!dependency) {
        colors.set(frame.node.id, 'black');
        frames.pop();
        path.pop();
        continue;
      }
      if (!residual.has(dependency.provider)) continue;
      const color = colors.get(dependency.provider);
      if (color === 'gray') {
        const start = path.indexOf(dependency.provider);
        return Object.freeze([...path.slice(start), dependency.provider]);
      }
      if (color === 'black') continue;
      const next = nodesById.get(dependency.provider);
      if (!next) continue;
      colors.set(next.id, 'gray');
      path.push(next.id);
      frames.push({ node: next, index: 0 });
    }
  }
  return Object.freeze([]);
}

/** Builds provider adjacency, indegree, longest-path levels, and stable schedule in Θ(V+E). */
export function buildCapabilityTopology(
  nodes: readonly ITopologyNode[],
  onUnknownProvider: (nodeId: IGraphNodeId, provider: IGraphNodeId) => never,
  onCycle: (path: readonly string[]) => never
): ICapabilityTopology {
  /** Node lookup used by admission and residual-cycle traversal. */
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  /** Reverse adjacency retained as reusable provider-to-consumer facts. */
  const consumersByProvider = new Map<string, ITopologyNode[]>();
  /** Forward dependency facts retained for dynamic topology consumers. */
  const providersByConsumer = new Map<string, readonly IGraphDependency[]>();
  for (const node of nodes) {
    providersByConsumer.set(node.id, node.dependencies);
    for (const edge of node.dependencies) {
      if (!nodesById.has(edge.provider)) onUnknownProvider(node.id, edge.provider);
      const consumers = consumersByProvider.get(edge.provider);
      if (consumers) consumers.push(node);
      else consumersByProvider.set(edge.provider, [node]);
    }
  }
  /** Mutable Kahn cursor; the returned snapshot remains the admission fact. */
  const indegree = new Map(nodes.map((node) => [node.id, node.dependencies.length]));
  const initialIndegree = new Map(indegree);
  const level = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0);
  const topological: ITopologyNode[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    topological.push(current);
    for (const consumer of consumersByProvider.get(current.id) ?? []) {
      level.set(
        consumer.id,
        Math.max(level.get(consumer.id) ?? 0, (level.get(current.id) ?? 0) + 1)
      );
      const nextDegree = (indegree.get(consumer.id) ?? 0) - 1;
      indegree.set(consumer.id, nextDegree);
      if (nextDegree === 0) queue.push(consumer);
    }
  }
  if (topological.length !== nodes.length) onCycle(findStableCyclePath(nodes, indegree));
  const layers: ITopologyNode[][] = [];
  for (const node of nodes) (layers[level.get(node.id) ?? 0] ??= []).push(node);
  return Object.freeze({
    ordered: Object.freeze(layers.flat()),
    providers: consumersByProvider,
    consumers: providersByConsumer,
    indegree: initialIndegree,
    level,
    ordinal: new Map(nodes.map((node) => [node.id, node.ordinal]))
  });
}
