import { definePartPlugin, type IPartPlugin } from '@migaia/part-host'
import { DEVTOOLS_PLUGIN } from './text.ts'

/**
 * Production build of the devtools plugin (chosen without the `development` condition): same name,
 * no Feature, no listeners, no DOM.
 */
export const devtoolsPlugin: IPartPlugin = definePartPlugin({ name: DEVTOOLS_PLUGIN })

export type { IDevtools } from './panel.ts'
