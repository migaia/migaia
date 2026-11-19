import { definePartPlugin, partCorePlugin, type IPartPlugin } from '@migaia/part-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { DevtoolsPanel } from './panel.ts'
import { DEVTOOLS_PLUGIN } from './text.ts'
import type { IStateSurface, ITraceSurface } from './views.ts'

/** Feature creating the panel of one host from its trace and state Features. */
const devtoolsFeature = defineFeature(
  (_core, deps: { readonly trace: object; readonly state: object }) =>
    new DevtoolsPanel(deps.trace as ITraceSurface, deps.state as IStateSurface),
  { trace: partCorePlugin.getFeature('trace'), state: partCorePlugin.getFeature('state') } as never
)

/**
 * Development inspection panel. Installing it adds the Feature `devtools` (`open`, `close`,
 * `select`, `selected`) and the Alt+Shift+D shortcut; removing it removes the panel and listeners.
 */
export const devtoolsPlugin: IPartPlugin = definePartPlugin({
  name: DEVTOOLS_PLUGIN,
  features: { devtools: devtoolsFeature },
  onInstall: (features, signal) => {
    /** Panel of this generation. */
    const panel = features.devtools as DevtoolsPanel
    panel.attach()
    signal.addEventListener('abort', () => panel.dispose(), { once: true })
  }
})
