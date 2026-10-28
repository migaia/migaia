import { prettyFeature, type ConsoleColorMode } from '../src/index.ts'
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
