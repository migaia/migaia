import { defineLogFeature } from '../feature-registry.ts'
import { FeatureKind, FeaturePhase, LogFormat } from '../state-constants.ts'
import { projectLogEntry, plainLogEntry } from '../projection.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'
import { invalidOption } from '../errors.ts'

/** JSON uses the single error-chain projection shared with every transport. */
function jsonEntry(entry: ILogEntry): string {
  return JSON.stringify(projectLogEntry(entry))
}
/** Select one host-owned format without giving output plugins a parallel formatting path. */
export function formatFeature(options: {
  format: 'json' | 'plain'
}): Extract<ILogFeature, { phase: 'format' }> {
  if (options.format !== LogFormat.json && options.format !== LogFormat.plain) throw invalidOption()
  return defineLogFeature({
    kind: FeatureKind.format,
    phase: FeaturePhase.format,
    format: options.format === LogFormat.json ? jsonEntry : plainLogEntry
  })
}
export default formatFeature
