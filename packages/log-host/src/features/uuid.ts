import { issueFeature } from '../feature-registry.ts'
import { FeatureKind, FeaturePhase } from '../state-constants.ts'
import type { ILogEntry, ILogFeature } from '../typing.ts'
import { defaultRandomUUID } from '../entry.ts'

/** Enrichment uses the installing host's generator, independent of display selection. */
class UuidFeature {
  /** Visibility is descriptor configuration; it never controls UUID generation. */
  #display: boolean
  /** Capture the presentation flag without reading a global runtime manager. */
  constructor(display: boolean) {
    this.#display = display
  }
  /** Copy only the entry data container while keeping all native user identities. */
  stage(entry: ILogEntry, randomUUID: () => string): ILogEntry {
    return { ...entry, data: { ...entry.data, uuid: randomUUID(), uuidDisplay: this.#display } }
  }
}
/** Issue host-level identity enrichment; output-local installation is rejected by scope admission. */
export function uuidFeature(options: { display?: boolean } = {}): ILogFeature {
  /** One descriptor can safely enrich entries from independent host generators. */
  const owner = new UuidFeature(options.display ?? false)
  return issueFeature(
    {
      kind: FeatureKind.uuid,
      phase: FeaturePhase.entry,
      stage: (entry: ILogEntry) => owner.stage(entry, defaultRandomUUID)
    },
    {
      kind: FeatureKind.uuid,
      phase: FeaturePhase.entry,
      stage: (entry, randomUUID) => owner.stage(entry, randomUUID)
    }
  )
}
export default uuidFeature
