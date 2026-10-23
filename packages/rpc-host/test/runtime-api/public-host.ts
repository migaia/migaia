import { defineHost, type IDefinedPluginConstraint } from '@migaia/plugin-host'
import type { IRuntimeDynamicSurface, IRuntimePluginTyping } from '@migaia/rpc-host/plugin'

/** These behavior fixtures explicitly opt into dynamic surfaces; strict type cases are separate. */
export type IRuntimeTestRegistry = readonly [
  IDefinedPluginConstraint &
    IRuntimePluginTyping<
      IRuntimeDynamicSurface,
      Record<never, never>,
      string,
      readonly [],
      'process'
    >,
  IDefinedPluginConstraint &
    IRuntimePluginTyping<
      IRuntimeDynamicSurface,
      Record<never, never>,
      string,
      readonly [],
      'thread'
    >,
  IDefinedPluginConstraint<
    any,
    any,
    any,
    any,
    any,
    string,
    Readonly<
      Record<
        string,
        import('@migaia/plugin-host').IFeature<any, Record<string, (payload: any) => any>>
      >
    >
  >
]

/** Dynamic fixture registration metadata adds no runtime Host wrapper or dispatch path. */
export const runtimeTestHost = defineHost<Record<string, never>, never, IRuntimeTestRegistry>
