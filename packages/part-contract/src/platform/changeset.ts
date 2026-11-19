import type { IIssue, IJsonPatchOperation } from '../types.ts'
import type { IProvenance } from './audit.ts'

/**
 * One artifact of a changeset. `base` is the draft hash the catalog returned for this item (`null`
 * when the item is new); the catalog compares it before applying. Module `name` must satisfy
 * `isModuleName`.
 */
export type IChangesetArtifact =
  | {
      readonly kind: 'blueprint'
      readonly id: string
      readonly base: string | null
      readonly patch: readonly IJsonPatchOperation[]
    }
  | {
      readonly kind: 'module'
      readonly name: string
      readonly base: string | null
      readonly source: string
    }
  | {
      readonly kind: 'remove'
      readonly target: 'blueprint' | 'module'
      readonly key: string
      readonly base: string
    }

/**
 * Atomic set of draft edits. There is no author field: the catalog takes the actor from the
 * caller's token.
 */
export type IChangeset = {
  readonly project: string
  readonly provenance: IProvenance
  readonly artifacts: readonly IChangesetArtifact[]
}

/** Per-artifact outcome; `skipped` marks artifacts not applied because another one failed. */
export const ChangesetStatus = {
  accepted: 'accepted',
  rejected: 'rejected',
  conflict: 'conflict',
  skipped: 'skipped'
} as const

/** One artifact status. */
export type ChangesetStatus = keyof typeof ChangesetStatus

/** Result of a changeset: `ok` only when every artifact was accepted and all were written. */
export type IChangesetResult = {
  readonly ok: boolean
  readonly artifacts: readonly {
    readonly key: string
    readonly status: ChangesetStatus
    readonly issues: readonly IIssue[]
    readonly hash?: string
  }[]
}

/** Key of an artifact in results: blueprint id, module name, or the removed key. */
export function artifactKey(artifact: IChangesetArtifact): string {
  if (artifact.kind === 'blueprint') return artifact.id
  if (artifact.kind === 'module') return artifact.name
  return artifact.key
}

/**
 * Base-version check: `conflict` when the artifact's `base` differs from the current hash of the
 * item (`null` when the item does not exist), otherwise `accepted`.
 */
export function checkBase(current: string | null, artifact: IChangesetArtifact): ChangesetStatus {
  return artifact.base === current ? ChangesetStatus.accepted : ChangesetStatus.conflict
}
