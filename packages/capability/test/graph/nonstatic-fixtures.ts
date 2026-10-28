/** Small resource fixtures used by dynamic graph and direct-value contract cases. */
import type { IGraphStartEntry } from '../../src/graph/dynamic.js'
import type { IGraphNodeInstance } from '../../src/graph/index.js'

/** Completes a primary release synchronously without creating another resource. */
export function releaseNothing(): void {}

/** Retains cases whose original primary release explicitly returned a fulfilled Promise. */
export async function releaseNothingAsync(): Promise<void> {}

/** Projects a startup binding into its original resource fixture without nested release callbacks. */
export function bindingInstance<TBinding>(
  entry: IGraphStartEntry<TBinding>
): IGraphNodeInstance<TBinding | undefined> {
  return { value: entry.binding, release: releaseNothingAsync }
}

/** Projects only public IDs for helper-owned snapshot arrays. */
export function topologyNodeId(node: { readonly id: string }): string {
  return node.id
}

/** Creates the original primary resource and its asynchronous release trace as one fixture job. */
export function tracedInstance(id: string, events: string[]): IGraphNodeInstance<string> {
  return {
    value: id,
    release: async () => {
      events.push(`release:${id}`)
    }
  }
}
