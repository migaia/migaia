import type { Archive } from './constants.js'
import type { IWhere, IOperationContext } from '@migaia/storage-contract'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'

/** Rules select string record keys against one cutoff captured by the explicit run. */
export type IArchiveRule<T = ICollectionsCodecValue> = {
  readonly name: string
  readonly prefix: string
  readonly where: (cutoffMs: number) => IWhere<T>
  readonly olderThanMs: number
  readonly segmentBytes?: number
}
/** The limit counts matching candidates across the selected rules. */
export type IArchiveRunOptions = IOperationContext & {
  readonly rule?: string
  readonly limit?: number
}
/** Only certainly committed segments contribute to progress. */
export type IArchiveRunResult = {
  readonly archived: number
  readonly skipped: number
  readonly segments: number
}
/** Reads do not restore unless the caller explicitly requests it. */
export type IArchiveGetOptions = IOperationContext & { readonly restore?: boolean }
/** Scanned counts native listing candidates; removed counts actual successful removals. */
export type IArchiveSweepResult = { readonly scanned: number; readonly removed: number }
/** Flat extension functions use the plugin id as a prefix and the host's organization context. */
export type IArchiveApi<N extends string = 'archive'> = {
  [K in `${N}${typeof Archive.runSuffix}`]: (
    options?: IArchiveRunOptions
  ) => Promise<IArchiveRunResult>
} & {
  [K in `${N}${typeof Archive.getSuffix}`]: (
    key: string,
    options?: IArchiveGetOptions
  ) => Promise<ICollectionsCodecValue | undefined>
} & {
  [K in `${N}${typeof Archive.sweepSuffix}`]: (
    ctx?: IOperationContext
  ) => Promise<IArchiveSweepResult>
}
/** Both backends must already be published by an earlier installation batch. */
export type IArchivePluginOptions<T = ICollectionsCodecValue> = {
  readonly id: string
  readonly hot: string
  readonly cold: string
  readonly rules: readonly IArchiveRule<T>[]
}
