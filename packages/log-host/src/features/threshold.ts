import { issueFeature } from '../feature-registry.ts'
import {
  FeatureKind,
  FeaturePhase,
  explicitLevel,
  levelOrder,
  LogLevel
} from '../state-constants.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'
import { invalidOption } from '../errors.ts'

/** A shared threshold owner allows one descriptor to control every scope where it is installed. */
class ThresholdFeature {
  /** Current standard threshold changes without replacing the issued descriptor identity. */
  #level: LogLevel
  /** Validate the initial policy before any host can retain it. */
  constructor(level: LogLevel) {
    this.#level = level
    this.setLevel(level)
  }
  /** Unknown tags bypass level threshold while category entries retain their explicit level. */
  accept(entry: ILogEntry): boolean {
    /** The fixed level order never grows with incoming arbitrary tags. */
    const level = Reflect.get(entry.data, explicitLevel) ?? entry.tag
    return (
      typeof level !== 'string' ||
      !Object.hasOwn(levelOrder, level) ||
      levelOrder[level] >= levelOrder[this.#level]
    )
  }
  /** Reject invalid live thresholds rather than publishing a malformed policy. */
  setLevel(level: LogLevel): void {
    if (!Object.hasOwn(levelOrder, level)) throw invalidOption()
    this.#level = level
  }
}
/** Create a mutable threshold policy behind one immutable issued descriptor. */
export function thresholdFeature(
  options: { level?: LogLevel } = {}
): ILogFeature & { setLevel(level: LogLevel): void } {
  /** State is shared deliberately when a descriptor is reused across outputs. */
  const owner = new ThresholdFeature(options.level ?? LogLevel.debug)
  return issueFeature(
    {
      kind: FeatureKind.threshold,
      phase: FeaturePhase.gate,
      accept: (entry: ILogEntry) => owner.accept(entry),
      setLevel: (level: LogLevel) => owner.setLevel(level)
    },
    {
      kind: FeatureKind.threshold,
      phase: FeaturePhase.gate,
      accept: (entry) => owner.accept(entry)
    }
  )
}
export default thresholdFeature
