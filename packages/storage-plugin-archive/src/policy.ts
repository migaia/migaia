import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { Archive } from './constants.ts'
import { ArchiveErrorCode } from '@migaia/storage-contract/error-code'
import { archiveError } from './errors.ts'
import type { IArchivePluginOptions, IArchiveRule } from './types.ts'

/** An installation snapshot never rereads mutable rule fields during a later run. */
export type IArchiveConfiguration = Readonly<{
  id: string
  hot: string
  cold: string
  rules: readonly (IArchiveRule & { readonly segmentBytes: number })[]
}>
/** Rule options are captured completely before borrowing a backend or registering work. */
export function snapshotArchiveOptions<T>(
  options: IArchivePluginOptions<T>
): IArchiveConfiguration {
  if (!options || typeof options !== 'object') throw archiveError(ArchiveErrorCode.invalidOption)
  const { id, hot, cold, rules } = options
  if (
    ![id, hot, cold].every((value) => typeof value === 'string' && value.length > 0) ||
    !Array.isArray(rules) ||
    rules.length === 0
  )
    throw archiveError(ArchiveErrorCode.invalidOption)
  const names = new Set<string>()
  const captured = rules.map((rule) => {
    if (!rule || typeof rule !== 'object') throw archiveError(ArchiveErrorCode.invalidOption)
    const { name, prefix, where, olderThanMs, segmentBytes = Archive.segmentBytes } = rule
    if (
      typeof name !== 'string' ||
      !name ||
      names.has(name) ||
      typeof prefix !== 'string' ||
      typeof where !== 'function' ||
      !Number.isSafeInteger(olderThanMs) ||
      olderThanMs < 0 ||
      !Number.isSafeInteger(segmentBytes) ||
      segmentBytes <= 0
    )
      throw archiveError(ArchiveErrorCode.invalidOption)
    names.add(name)
    return {
      name,
      prefix,
      where: where as (cutoff: number) => ReturnType<IArchiveRule<ICollectionsCodecValue>['where']>,
      olderThanMs,
      segmentBytes
    }
  })
  return { id, hot, cold, rules: captured }
}
/** UTF-16 string order bounds a prefix without ever entering the tuple metadata domain. */
export function prefixUpper(prefix: string): string | undefined {
  for (let index = prefix.length - 1; index >= 0; index--) {
    const unit = prefix.charCodeAt(index)
    if (unit < 0xffff) return prefix.slice(0, index) + String.fromCharCode(unit + 1)
  }
  return undefined
}
