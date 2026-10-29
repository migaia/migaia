import { defineNativeLogFeature, type ILogFeatureRuntime } from '../feature-metadata.ts'
import { FeaturePhase, explicitLevel, levelOrder, LogLevel } from '../state-constants.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'
import { invalidOption } from '../errors.ts'

/** A plugin exposes only its own installed threshold control through native extensions. */
type IThresholdControls = { setLevel(level: LogLevel): void }

/** One native installation owns its threshold independently of every other registration. */
class ThresholdFeature {
  /** Current standard threshold changes only within this native installation. */
  #level: LogLevel
  /** Initial policy was synchronously validated while defining the native feature. */
  constructor(level: LogLevel) {
    this.#level = level
  }
  /** Return forwarding methods tied to this installation's explicitly owned state. */
  runtime(): ILogFeatureRuntime<IThresholdControls> {
    return {
      implementation: Object.freeze({
        phase: FeaturePhase.gate,
        accept: (entry: ILogEntry) => this.accept(entry)
      }),
      controls: Object.freeze({ setLevel: (level: LogLevel) => this.setLevel(level) })
    }
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
/** Define a cold native threshold whose mutable controls belong to its installed plugin. */
export function thresholdFeature(
  options: { level?: LogLevel } = {}
): ILogFeature<IThresholdControls> {
  /** Snapshot the initial value without constructing mutable runtime state before installation. */
  const level = options.level ?? LogLevel.debug
  if (!Object.hasOwn(levelOrder, level)) throw invalidOption()
  return defineNativeLogFeature({ phase: FeaturePhase.gate }, () =>
    new ThresholdFeature(level).runtime()
  )
}
export default thresholdFeature
