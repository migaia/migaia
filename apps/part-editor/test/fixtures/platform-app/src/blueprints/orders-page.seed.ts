// @partom-generated sha256:5bbac81e062680f3f6f351119ef4517e0eaa63b6c2ed563d061e60715bcc020a
import { definePartPlugin, partCorePlugin } from '@migaia/part-host'
import { defineFeature } from '@migaia/plugin-host/features'

/** State surface the seed plugin writes through. */
type IStateSeeder = { seed(path: string, value: unknown): void }

/** The core state Feature, taken as this plugin's own Feature output. */
const stateFeature = defineFeature((_core, deps: { readonly state: IStateSeeder }) => deps.state, {
  state: partCorePlugin.getFeature('state')
} as never)

/** Plugin seeding the page state once its catalog entries are registered. */
export default definePartPlugin({
  name: 'orders-page-seed',
  features: { state: stateFeature },
  onInstall: (features) => {
    /** Core state Feature. */
    const state = features.state as IStateSeeder
    state.seed('page.status', 'open')
    state.seed('page.orders', [])
  }
})
