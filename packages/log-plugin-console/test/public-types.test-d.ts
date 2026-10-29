import { createLogHost } from '@migaia/log-host'
import { filterFeature, thresholdFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature, type ConsoleColorMode } from '../src/index.ts'
// @ts-expect-error The canonical color domain has no legacy alias export.
import type { IColorMode } from '../src/index.ts'

/** The approved runtime/type namespace remains the canonical public color union. */
const color: ConsoleColorMode = 'never'
/** The actual public feature options accept that same color policy without another exported alias. */
const optionColor: NonNullable<Parameters<typeof prettyFeature>[0]>['color'] = color
/** Keep the forbidden import assertion live only at compile time. */
const removedAlias = undefined as unknown as IColorMode
void color
void optionColor
void removedAlias

/** Installed controls are inferred from the native feature aliases declared by this output. */
const controlledConsole = createLogHost({
  plugins: [consolePlugin({ features: { threshold: thresholdFeature(), filter: filterFeature() } })]
})
controlledConsole.console_threshold_setLevel('warn')
/** A filter installation returns its independently revocable registration capability. */
const removeFilter = controlledConsole.console_filter_add(() => true)
removeFilter()
// @ts-expect-error Native features have no descriptor control methods.
thresholdFeature().setLevel('warn')
// @ts-expect-error Output declarations accept only the native record form.
consolePlugin({ features: [prettyFeature()] })
