/** Config path admission and readonly value projection over the canonical object-path parser. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { parseObjectPath, probeObjectPath, type IObjectPathTupleFor } from '../object-path.ts'
import type {
  IConfigLimits,
  IConfigReadResult,
  IConfigRecord,
  IOwnedConfig
} from './config-contract.ts'
import { configError, dangerous, defaultLimits, metadata } from './config-state.ts'
import { readonlyWrap } from './config-readonly.ts'

/** Applies config limits and string-key policy over the canonical object-path parser. */
export function parseConfigPath(
  path: string,
  limits: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'> = defaultLimits
): readonly string[] {
  if (path.length === 0 || path.length > limits.maxPathLength)
    throw configError(UtilsErrorCode.configPathInvalid, path, ConfigReason.invalidLength)
  /** Canonical parsing may fail; config admission preserves the original failure as its cause. */
  let parsed: readonly PropertyKey[]
  try {
    parsed = parseObjectPath(path)
  } catch (error) {
    throw configError(UtilsErrorCode.configPathInvalid, path, ConfigReason.invalidSegment, error)
  }
  /** Keep original bracket digit text while reusing canonical object-path validation. */
  const sourceSegments = path.split('.')
  /** Normalize canonical numeric path segments while preserving their original digit spelling. */
  const result = parsed.map((segment, index) =>
    typeof segment === 'number' ? /^\[(\d+)\]$/.exec(sourceSegments[index])![1] : String(segment)
  )
  for (const segment of result) {
    if (segment.length > limits.maxSegmentLength || dangerous.has(segment))
      throw configError(UtilsErrorCode.configPathInvalid, segment, ConfigReason.invalidSegment)
  }
  return Object.freeze(result)
}

/** Reads a config path and distinguishes missing from an undefined value. */
export function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult {
  if (!metadata.has(config as object))
    throw configError(UtilsErrorCode.configUnsupported, 'config', ConfigReason.valueNotOwned)
  /** Validate the supplied path before requesting its canonical owned-value projection. */
  const segments = typeof path === 'string' ? parseConfigPath(path) : path
  if (segments.length > defaultLimits.maxPathLength)
    throw configError(UtilsErrorCode.configPathInvalid, 'path', ConfigReason.invalidLength)
  for (const segment of segments) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.length > defaultLimits.maxSegmentLength ||
      dangerous.has(segment)
    )
      throw configError(
        UtilsErrorCode.configPathInvalid,
        String(segment),
        ConfigReason.invalidSegment
      )
  }
  /** The canonical path probe owns getter order and distinguishes absence from read failure. */
  const probe = probeObjectPath(config, segments as IObjectPathTupleFor<IConfigRecord>)
  if (probe.kind === 'failed') throw probe.error
  if (probe.kind !== 'value') return { kind: 'missing' }
  /** This edge value is captured once before deletion, rebasing or graph projection. */
  const value: unknown = probe.value
  return {
    kind: 'value',
    value:
      value && (typeof value === 'object' || typeof value === 'function')
        ? readonlyWrap(value)
        : value
  }
}
