import { expect, it } from 'vitest'
import { createLogHost, type ILogPluginCore, type ILogEntry } from '../../src/index.ts'
import { filterFeature } from '../../src/features/filter.ts'
import { CaptureOutput, messageOf } from '../fixtures/output.ts'

/** Callable config snapshots still preserve reference identity across the real peer boundary. */
class CallableConfigPlugin {
  /** The fixture is a real plugin with host-owned configuration copying. */
  readonly name = 'callable-config'
  /** This exact predicate reference must survive configuration admission. */
  readonly config = { filters: [rejectAll] }
  /** Issued feature state owns only its installed filter registrations. */
  #feature: ReturnType<typeof filterFeature>
  /** The independently removable registration is produced by the real feature factory. */
  off: (() => void) | undefined
  /** Retain the actual captured config function for an explicit identity discriminator. */
  captured: ((entry: ILogEntry) => boolean) | undefined
  /** Capture the policy before the host installs this configuration fixture. */
  constructor(feature: ReturnType<typeof filterFeature>) {
    this.#feature = feature
  }
  /** Read config through the actual scoped peer reader, then install that original predicate. */
  install(core: ILogPluginCore): Record<string, never> {
    /** A replacement or clone would fail exact identity even if token-based removal still worked. */
    const config = core.config.get()
    /** This fixture owns the declared config shape; callable identity is still asserted at runtime. */
    const filters = config.filters as Array<(entry: ILogEntry) => boolean>
    this.captured = filters[0]
    this.off = this.#feature.add(filters[0])
    return {}
  }
}
/** Original filter behavior deliberately rejects every initial log entry. */
function rejectAll(): boolean {
  return false
}
/**
 * Filter removal retains business behavior while the explicit reference check preserves the old
 * oracle.
 */
async function callableIdentity(): Promise<void> {
  /** Policy state is the approved replacement owner for removed level filtering methods. */
  const filter = filterFeature()
  /** This fixture forces the predicate through canonical plugin config admission. */
  const plugin = new CallableConfigPlugin(filter)
  /** Delivered records are observed through the real SDK transport. */
  const output = new CaptureOutput()
  /** The application installs the same feature used by the config-owning plugin. */
  const host = createLogHost({ features: [filter], plugins: [plugin, output.plugin()] })
  host.log('info', 'blocked')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual([])
  expect(plugin.captured).toBe(rejectAll)
  plugin.off!()
  host.log('info', 'allowed')
  await host.flush()
  expect(output.records.map(messageOf)).toEqual(['allowed'])
  await host.shutdown('manual')
}
it('supports logger filter removal with callable configuration identity', callableIdentity)
