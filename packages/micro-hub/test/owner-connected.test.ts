import { expect, it } from 'vitest'
import { createMicroHub, defineContract } from '../src/index.ts'
import { defineMicroPlugin, type IAppRuntime, type IHubRuntime } from '../src/driver.ts'
import { MicroCapability } from '../src/text.ts'

/** Records what a third-party driver observes through the driver runtime API. */
class ProbeDriver {
  readonly kind = MicroCapability.events
  /** Owner runtimes handed to `own`. */
  readonly owners: IAppRuntime[] = []
  /** Number of ownership change notifications seen. */
  changes = 0
  /** Unsubscribe functions returned by onOwnerChange. */
  readonly unsubscribes: Array<() => void> = []

  /** Hub runtime handed to the driver factory. */
  readonly #hub: IHubRuntime

  constructor(hub: IHubRuntime) {
    this.#hub = hub
  }

  /** Contributes no view members. */
  view = () => ({})

  /** Records the owner runtime and subscribes to ownership changes of this contract. */
  own = (entry: Parameters<IHubRuntime['onOwnerChange']>[0], app: IAppRuntime) => {
    this.owners.push(app)
    this.unsubscribes.push(
      this.#hub.onOwnerChange(entry, () => {
        this.changes += 1
      })
    )
    return {}
  }
}

it('lets a driver read owner connectivity and observe ownership changes', async () => {
  let probe!: ProbeDriver
  const plugin = defineMicroPlugin(MicroCapability.events, [], (hub) => {
    probe = new ProbeDriver(hub)
    return probe
  })
  const contract = defineContract('connected-probe', { version: 1 })
  const hub = createMicroHub({ plugins: [plugin] })
  const app = hub.connect('owner')
  app.own(contract)
  expect(probe.owners[0]!.connected).toBe(true)
  await app.disconnect()
  expect(probe.owners[0]!.connected).toBe(false)
  expect(probe.changes).toBeGreaterThan(0)
  for (const unsubscribe of probe.unsubscribes) unsubscribe()
  await hub.dispose()
})
