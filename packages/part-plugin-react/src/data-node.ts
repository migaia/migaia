/** Data-layer helpers of the renderer: resource snapshots, status slots and field values. */
import {
  FieldRead,
  isResourceBinding,
  ResourceStatus,
  type IFieldBehavior,
  type IResourceBinding,
  type IResourceSnapshot
} from '@migaia/part-contract'
import type { IResolvedNode, IResourceHandle, IResourceWatch } from '@migaia/part-host'

/**
 * Attribute names the renderer writes on a resource node's root element. Stable contract: tests and
 * styles select on them.
 */
export const ResourceAttribute = {
  status: 'data-resource-status',
  busy: 'aria-busy'
} as const

/** Snapshot shown before the commit-phase watch exists: the first frame already shows loading. */
export const PENDING_SNAPSHOT: IResourceSnapshot = Object.freeze({
  status: ResourceStatus.loading,
  refreshing: false
})

/** The resource binding of a node, when its part declares a resource prop and the prop holds one. */
export function resourceBindingOf(node: IResolvedNode | undefined): IResourceBinding | undefined {
  /** Prop that receives the snapshot. */
  const prop = node?.behavior.resource?.prop
  /** Value of that prop. */
  const value = prop === undefined ? undefined : node?.config.props?.[prop]
  return isResourceBinding(value) ? value : undefined
}

/**
 * Starts a watch for a commit and hands it to the component state; returns the cleanup that
 * releases it. Runs in the commit phase only, so a discarded render never subscribes.
 */
export function startWatch(
  resources: IResourceHandle,
  binding: IResourceBinding | undefined,
  row: Readonly<Record<string, unknown>> | undefined,
  setWatch: (watch: IResourceWatch | undefined) => void
): (() => void) | undefined {
  if (binding === undefined) return undefined
  /** Watch of this commit. */
  const watch = resources.watch(binding, row)
  setWatch(watch)
  return () => watch.release()
}

/**
 * Template rows taken from a snapshot: `data` or `data.items`, also while an error snapshot keeps
 * the previous data; none before any data arrived.
 */
export function rowsOf(snapshot: IResourceSnapshot): unknown {
  if (Array.isArray(snapshot.data)) return snapshot.data
  /** Items of an object result. */
  const items = (snapshot.data as { items?: unknown } | null | undefined)?.items
  return Array.isArray(items) ? items : []
}

/** The status slot to show instead of the component, when mapped and filled in the blueprint. */
export function statusSlotOf(node: IResolvedNode, snapshot: IResourceSnapshot): string | undefined {
  /** Slot mapped for the current status. */
  const slot = (node.behavior.resource?.slots as Readonly<Record<string, string>> | undefined)?.[
    snapshot.status
  ]
  return slot !== undefined && (node.slots[slot]?.length ?? 0) > 0 ? slot : undefined
}

/** Slot names a resource group maps to statuses; they are never passed to the component. */
export function statusSlotNames(node: IResolvedNode): ReadonlySet<string> {
  return new Set(Object.values(node.behavior.resource?.slots ?? {}))
}

/** Root attributes describing a snapshot. */
export function resourceAttributes(snapshot: IResourceSnapshot): Record<string, string> {
  /** Whether a load runs. */
  const busy = snapshot.status === ResourceStatus.loading || snapshot.refreshing
  return {
    [ResourceAttribute.status]: snapshot.status,
    ...(busy ? { [ResourceAttribute.busy]: 'true' } : {})
  }
}

/** New field value carried by a change callback argument, per the field's read mode. */
export function fieldValue(field: IFieldBehavior, detail: unknown): unknown {
  if ((field.read ?? FieldRead.detail) === FieldRead.detail) return detail
  /** Event target of the argument. */
  const target = (detail as { target?: Record<string, unknown> } | null | undefined)?.target
  if (target === undefined || target === null) return undefined
  return field.read === FieldRead.targetChecked ? target.checked : target.value
}

/** State path a field's value prop is bound to, when it is a `$state` binding. */
export function fieldPathOf(node: IResolvedNode): string | undefined {
  /** Field protocol of the part. */
  const field = node.behavior.field
  /** Value prop binding. */
  const value = field === undefined ? undefined : node.config.props?.[field.value]
  return typeof (value as { $state?: unknown } | undefined)?.$state === 'string'
    ? (value as { $state: string }).$state
    : undefined
}
