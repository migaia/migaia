/**
 * Projects canonical PluginHost admissions into Graph nodes and computes provider-first waves.
 * Publishes no managed state and owns no plugin lifecycle, lease or cleanup resource.
 */
import {
  readPluginDependencies,
  type IPluginAdmission,
  type IPluginConstraint
} from '@migaia/plugin-host'
import type { IDynamicGraphNodeDefinition } from '@migaia/capability/graph/dynamic'
import type { IPluginHostCompositionIntegration } from '@migaia/plugin-host/composition'
import { TrayErrorCode } from '../error-code.ts'
import { createTrayError } from '../errors.ts'
import { ManagedHostGraphKind } from './constants.ts'
import type { IAdmissionRecord, IGraphId, IPluginBinding, IPluginSnapshot } from './host-context.ts'

/** Rejects stale descriptors, captures one admission and preserves producer errors on cause. */
export function admitTrayPlugin(
  plugin: IPluginBinding,
  composition: IPluginHostCompositionIntegration<object>
): Readonly<{
  readonly snapshot: IPluginSnapshot
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
}> {
  if (plugin !== null && plugin !== undefined && Object.hasOwn(plugin, 'requires'))
    throw createTrayError(TrayErrorCode.invalidEntry)
  try {
    /** PluginHost validates the name and install field while capturing Feature getters once. */
    const admission = composition.createPluginAdmission<IPluginConstraint<any>>(plugin)
    /** The reader inspects that exact snapshot without touching the descriptor again. */
    const dependencies = readPluginDependencies(admission)
    return { admission, snapshot: Object.freeze({ name: plugin.name, dependencies }) }
  } catch (original) {
    throw createTrayError(TrayErrorCode.invalidEntry, original)
  }
}

/** Graph value leases own no physical cleanup; the composition release batch retains that duty. */
export async function releaseGraphValue(): Promise<void> {
  return undefined
}

/** Converts one Tray descriptor into the sole Graph lifecycle node projection. */
export function toGraphNode(admission: IAdmissionRecord): IDynamicGraphNodeDefinition<unknown> {
  /** The immutable admitted name is the sole capability Graph identity. */
  const id = admission.snapshot.name as IGraphId
  return {
    id,
    kind: ManagedHostGraphKind,
    dependencies: admission.snapshot.dependencies.map(({ provider, required }) => ({
      provider: provider as IGraphId,
      required
    })),
    start: async () => {
      return {
        value: admission.plugin,
        release: releaseGraphValue
      }
    }
  }
}

/** One batch index records the earliest admission wave of each dependency-satisfied record. */
type IAdmissionLevels = {
  readonly levels: ReadonlyMap<IAdmissionRecord, number>
  readonly readyNames: ReadonlySet<string>
  readonly presentNames: ReadonlySet<string>
}

/** Resolve dependency edges once in O(records + dependencies), preserving duplicate-name readiness. */
function resolveAdmissionLevels(
  records: readonly IAdmissionRecord[],
  requiredOnly: boolean
): IAdmissionLevels {
  /** Presence is distinct from readiness; absent optional providers never delay admission. */
  const presentNames = new Set(records.map((record) => record.snapshot.name))
  /** Each provider name wakes its dependents once, even when several records share that name. */
  const dependents = new Map<string, IAdmissionRecord[]>()
  /** Pending counts include repeated edges, whose corresponding adjacency entries release them. */
  const pending = new Map<IAdmissionRecord, number>()
  /** A record's wave is one after its latest required present provider. */
  const levels = new Map<IAdmissionRecord, number>()
  /** Deferred wave candidates accumulate while the record still has unresolved dependencies. */
  const candidates = new Map<IAdmissionRecord, number>()
  /** Cursor processing preserves breadth-first provider waves without shift or re-sorting. */
  const queue: IAdmissionRecord[] = []
  /** Original name readiness is fulfilled by the first eligible record of that name. */
  const readyNames = new Set<string>()
  for (const record of records) {
    /** Missing required providers remain unresolved only in the initial-ready projection. */
    let count = 0
    for (const { provider, required } of record.snapshot.dependencies) {
      if (requiredOnly && !required) continue
      if (!presentNames.has(provider)) {
        if (requiredOnly) count++
        continue
      }
      count++
      /** One adjacency entry corresponds to one counted dependency edge. */
      const waiting = dependents.get(provider) ?? []
      waiting.push(record)
      dependents.set(provider, waiting)
    }
    pending.set(record, count)
    if (count === 0) {
      levels.set(record, 0)
      queue.push(record)
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    /** FIFO work guarantees that a name's first admitted record has its earliest wave. */
    const record = queue[cursor]!
    /** Later duplicate records do not announce the same provider a second time. */
    const name = record.snapshot.name
    if (readyNames.has(name)) continue
    readyNames.add(name)
    for (const dependent of dependents.get(name) ?? []) {
      /** All present providers of this record contribute to its final wave. */
      const nextLevel = Math.max(candidates.get(dependent) ?? 0, levels.get(record)! + 1)
      candidates.set(dependent, nextLevel)
      /** Release exactly this adjacency entry. */
      const remaining = pending.get(dependent)! - 1
      pending.set(dependent, remaining)
      if (remaining === 0) {
        levels.set(dependent, nextLevel)
        queue.push(dependent)
      }
    }
  }
  return { levels, readyNames, presentNames }
}

/** Test the original required-edge predicate without nesting it inside the admission-wave scan. */
function hasMissingRequiredProvider(
  record: IAdmissionRecord,
  presentNames: ReadonlySet<string>
): boolean {
  return record.snapshot.dependencies.some(
    ({ provider, required }) => required && !presentNames.has(provider)
  )
}

/** Preserve original per-wave input order with stable buckets instead of repeated global scans. */
export function orderAdmissions(records: readonly IAdmissionRecord[]): IAdmissionRecord[] {
  /** Every present provider, including optional providers, precedes its consumers. */
  const { levels, presentNames } = resolveAdmissionLevels(records, false)
  /** At most one new wave per record, so bucket traversal is linear in record count. */
  const waves: IAdmissionRecord[][] = []
  /**
   * Cyclic remnants retain their original insertion order for the existing missing-provider
   * fallback.
   */
  const remaining: IAdmissionRecord[] = []
  for (const record of records) {
    /** A missing level identifies a record still blocked by a present dependency cycle. */
    const level = levels.get(record)
    if (level === undefined) remaining.push(record)
    else (waves[level] ??= []).push(record)
  }
  /** Flattening walks each record once and retains original ordering inside a wave. */
  const ordered = waves.flat()
  if (remaining.length > 0) {
    if (!remaining.some((record) => hasMissingRequiredProvider(record, presentNames)))
      throw createTrayError(TrayErrorCode.invalidEntry)
    ordered.push(...remaining)
  }
  return ordered
}

/** Select definitions whose complete required-provider closure is present, in original input order. */
export function computeReadyAdmissions(records: readonly IAdmissionRecord[]): IAdmissionRecord[] {
  /** Optional dependencies do not block this initial-ready projection. */
  const { readyNames } = resolveAdmissionLevels(records, true)
  /** Keep the original ordered projection without a per-call filter callback allocation. */
  const ready: IAdmissionRecord[] = []
  for (const record of records) {
    if (readyNames.has(record.snapshot.name)) ready.push(record)
  }
  return ready
}
