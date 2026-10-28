import {
  assertVersionedEnvelope,
  type IStorageKey,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { Archive } from './constants.ts'
import { invalidSegment } from './errors.ts'

/** Manifest identity is stable only for a particular immutable segment line and selecting rule. */
export type IArchiveManifest = Readonly<{ segmentId: string; line: number; rule: string }>
/** Private tuple keys occupy a domain disjoint from every supported business string key. */
export const controlKey = (id: string): IStorageKey => [Archive.root, id, Archive.control]
/** Each business key has at most one current manifest. */
export const manifestKey = (id: string, key: string): IStorageKey => [
  Archive.root,
  id,
  Archive.manifest,
  key
]
/** Segment references are point-read by sweep rather than recomputed by a manifest scan. */
export const directoryKey = (id: string, segment: string): IStorageKey => [
  Archive.root,
  id,
  Archive.segment,
  segment
]
/** Metadata shape failures never silently become absent manifests or zero references. */
function stateOf(value: unknown): Record<string, unknown> {
  try {
    const envelope = assertVersionedEnvelope(value)
    if (
      envelope.version !== Archive.version ||
      typeof envelope.state !== 'object' ||
      envelope.state === null ||
      Array.isArray(envelope.state)
    )
      throw invalidSegment()
    return envelope.state as Record<string, unknown>
  } catch (cause) {
    throw invalidSegment(cause)
  }
}
/** Missing manifest is distinct from a malformed existing manifest. */
export function readManifest(value: unknown): IArchiveManifest | undefined {
  if (value === undefined) return undefined
  const state = stateOf(value),
    { segmentId, line, rule } = state
  if (
    typeof segmentId !== 'string' ||
    segmentId.length === 0 ||
    !Number.isSafeInteger(line) ||
    (line as number) < 0 ||
    typeof rule !== 'string' ||
    rule.length === 0
  )
    throw invalidSegment()
  return { segmentId, line: line as number, rule }
}
/** Missing directory denotes an orphan; malformed existing reference counts are corruption. */
export function readRefs(value: unknown): number {
  if (value === undefined) return 0
  const { refs } = stateOf(value)
  if (!Number.isSafeInteger(refs) || (refs as number) < 0) throw invalidSegment()
  return refs as number
}
/** Exact immutable identity closes the finite get/restore race without polling or generations. */
export const sameManifest = (a: IArchiveManifest | undefined, b: IArchiveManifest): boolean =>
  a?.segmentId === b.segmentId && a.line === b.line && a.rule === b.rule
/** Reference changes share the original hot transaction and are rolled back with its business write. */
export async function changeRefs(
  tx: ITransactionScope<ICollectionsCodecValue>,
  id: string,
  segment: string,
  delta: number
): Promise<void> {
  const key = directoryKey(id, segment),
    refs = readRefs(await tx.getRecord(key)) + delta
  if (!Number.isSafeInteger(refs) || refs < 0) throw invalidSegment()
  if (refs === 0) await tx.deleteRecord(key)
  else await tx.putRecord({ version: Archive.version, state: { refs } }, key)
}
