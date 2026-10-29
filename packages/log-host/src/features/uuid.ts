import { defineNativeLogFeature, type ILogFeatureRuntime } from '../feature-metadata.ts'
import { FeaturePhase } from '../state-constants.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'

/** Enrichment uses the installing host's generator, independent of display selection. */
class UuidFeature {
  /** Visibility is native-definition policy; it never controls UUID generation. */
  #display: boolean
  /** Capture this installation's presentation flag without reading a global runtime manager. */
  constructor(display: boolean) {
    this.#display = display
  }
  /** The installed entry stage borrows the receiving host's generator on every enrichment. */
  runtime(): ILogFeatureRuntime {
    return {
      implementation: Object.freeze({
        phase: FeaturePhase.entry,
        stage: (entry: ILogEntry, randomUUID: () => string) => this.stage(entry, randomUUID)
      }),
      controls: Object.freeze({})
    }
  }
  /** Copy only the entry data container while keeping all native user identities. */
  stage(entry: ILogEntry, randomUUID: () => string): ILogEntry {
    return { ...entry, data: { ...entry.data, uuid: randomUUID(), uuidDisplay: this.#display } }
  }
}
/** Define host-wide identity enrichment; an output-local declaration is rejected during admission. */
export function uuidFeature(options: { display?: boolean } = {}): ILogFeature {
  /** Capture definition policy while each native installation creates its own stage owner. */
  const display = options.display ?? false
  return defineNativeLogFeature({ phase: FeaturePhase.entry }, () =>
    new UuidFeature(display).runtime()
  )
}
export default uuidFeature
