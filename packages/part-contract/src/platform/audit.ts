import type { IBlueprint, IPartNode } from '../types.ts'
import {
  childGroupKeys,
  groupValue,
  indexSide,
  jsonOf,
  NODE_GROUPS,
  type IIndexedSide
} from './merge.ts'

/**
 * Who or what produced a change. `generator` marks tool output (importers, codegen); `agent`
 * carries the model name and a hash of the intent that produced it.
 */
export type IProvenance = {
  readonly authorKind: 'human' | 'agent' | 'generator'
  readonly model?: string
  readonly intentHash?: string
}

/** One changed target of an audited write: an address and group, a blueprint, or a module name. */
export type IAuditTarget = {
  readonly address?: string
  readonly facet?: string
  readonly blueprint?: string
  readonly module?: string
}

/** Actions the catalog audits; one record per write request. */
export const AuditAction = {
  changeset: 'changeset',
  publish: 'publish',
  promote: 'promote',
  rollback: 'rollback',
  token: 'token',
  upload: 'upload',
  env: 'env'
} as const

/** One audited action. */
export type AuditAction = keyof typeof AuditAction

/**
 * Audit record of one write. `actor` comes from the caller's token, never from the request body;
 * records carry no token, configuration value or source text.
 */
export type IAuditRecord = {
  readonly at: string
  readonly actor: string
  readonly project: string
  readonly env?: string
  readonly action: AuditAction
  readonly targets: readonly IAuditTarget[]
  readonly provenance?: IProvenance
  readonly outcome: 'ok' | 'rejected'
}

/** Changed groups of one address present on both sides, appended to `targets`. */
function diffAddress(
  before: IIndexedSide,
  after: IIndexedSide,
  address: string,
  targets: IAuditTarget[]
): void {
  /** The node on each side. */
  const beforeNode = before.index.get(address)?.node as IPartNode
  const afterNode = after.index.get(address)?.node as IPartNode
  for (const group of NODE_GROUPS)
    if (jsonOf(groupValue(beforeNode, group)) !== jsonOf(groupValue(afterNode, group)))
      targets.push({ address, facet: group })
  /** Child lists of each side. */
  const beforeLists = before.lists.get(address)
  const afterLists = after.lists.get(address)
  for (const key of childGroupKeys(beforeLists, afterLists))
    if (jsonOf(beforeLists?.get(key)) !== jsonOf(afterLists?.get(key)))
      targets.push({ address, facet: key })
}

/**
 * Changed `(address, group)` pairs between two versions of a blueprint, in document order: changed
 * groups and child lists of addresses on both sides, and `node` for added or removed addresses. A
 * missing side counts as an empty blueprint.
 */
export function auditTargets(
  before: IBlueprint | undefined,
  after: IBlueprint | undefined
): IAuditTarget[] {
  /** Indexed sides; undefined when absent. */
  const beforeSide = before === undefined ? undefined : indexSide(before)
  const afterSide = after === undefined ? undefined : indexSide(after)
  /** Collected targets. */
  const targets: IAuditTarget[] = []
  for (const entry of afterSide?.index.entries() ?? []) {
    if (beforeSide?.index.get(entry.address) === undefined)
      targets.push({ address: entry.address, facet: 'node' })
    else diffAddress(beforeSide, afterSide as IIndexedSide, entry.address, targets)
  }
  for (const entry of beforeSide?.index.entries() ?? [])
    if (afterSide?.index.get(entry.address) === undefined)
      targets.push({ address: entry.address, facet: 'node' })
  return targets
}
